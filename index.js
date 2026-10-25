
import 'dotenv/config';
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion
} from '@whiskeysockets/baileys';
import pino from 'pino';
import fs from 'node:fs';

const gruposPermitidos = (
  process.env.WHATSAPP_GROUPS || 'SOSRIM|RPA Hemodiálise'
)
  .split('|')
  .map(nome => nome.trim().toLocaleLowerCase('pt-BR'))
  .filter(Boolean);

const modoTeste =
  (process.env.DRY_RUN || 'true').toLowerCase() !== 'false';

const pastaSessao = '.auth_info';

function interpretarMensagem(texto) {
  const original = String(texto || '').replace(/\r/g, '').trim();

  const maquina = original.match(
    /\b(?:máquina|maquina|maq\.?)\s*#?\s*(\d{1,2})\b/i
  );

  const horario = original.match(
    /\b(?:liberada|liberado)\s*(?:às|as|a)?\s*(\d{1,2}:\d{2})\b/i
  );

  if (!maquina || !horario) {
    return null;
  }

  const numero = Number(maquina[1]);

  // O SOSRIM possui 18 máquinas.
  if (numero < 1 || numero > 18) {
    return null;
  }

  const linhas = original
    .split('\n')
    .map(linha => linha.trim())
    .filter(Boolean);

  const local = linhas.find(linha =>
    /sugisawa|hospital|cl[ií]nica/i.test(linha)
  ) || '';

  return {
    maquina: numero,
    horarioLiberacao: horario[1],
    local,
    mensagemOriginal: original
  };
}

async function iniciar() {
  fs.mkdirSync(pastaSessao, { recursive: true });

  const { state, saveCreds } =
    await useMultiFileAuthState(pastaSessao);

  const { version } = await fetchLatestBaileysVersion();

  const socket = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: true,
    browser: ['SOSRIM', 'Chrome', '1.0.0'],
    markOnlineOnConnect: false
  });

  socket.ev.on('creds.update', saveCreds);

  socket.ev.on('connection.update', ({ connection, lastDisconnect }) => {
    if (connection === 'open') {
      console.log('WhatsApp conectado.');
      console.log('Modo de teste:', modoTeste);
    }

    if (connection === 'close') {
      const codigo =
        lastDisconnect?.error?.output?.statusCode;

      if (codigo !== DisconnectReason.loggedOut) {
        console.log('Conexão interrompida. Tentando reconectar...');
        setTimeout(() => iniciar().catch(console.error), 3000);
      } else {
        console.error(
          'Sessão encerrada. Será necessário parear novamente.'
        );
      }
    }
  });

  socket.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const mensagem of messages) {
      if (!mensagem.message || mensagem.key.fromMe) continue;

      const jid = mensagem.key.remoteJid || '';

      // Ignora conversas individuais.
      if (!jid.endsWith('@g.us')) continue;

      let nomeGrupo = '';

      try {
        const dadosGrupo = await socket.groupMetadata(jid);
        nomeGrupo = dadosGrupo.subject || '';
      } catch {
        continue;
      }

      if (
        !gruposPermitidos.includes(
          nomeGrupo.trim().toLocaleLowerCase('pt-BR')
        )
      ) {
        continue;
      }

      const conteudo = mensagem.message;

      const texto =
        conteudo.conversation ||
        conteudo.extendedTextMessage?.text ||
        conteudo.imageMessage?.caption ||
        conteudo.documentMessage?.caption ||
        '';

      if (!texto) continue;

      const resultado = interpretarMensagem(texto);

      console.log(JSON.stringify({
        dataRecebimento: new Date().toISOString(),
        grupo: nomeGrupo,
        mensagemReconhecida: Boolean(resultado),
        dados: resultado
      }, null, 2));

      if (resultado && modoTeste) {
        console.log(
          'TESTE: mensagem reconhecida. Nenhuma máquina foi alterada.'
        );
      } else if (resultado) {
        console.error(
          'Gravação desativada: Firebase ainda não foi integrado.'
        );
      }
    }
  });
}

iniciar().catch(erro => {
  console.error('Erro ao iniciar o serviço:', erro);
  process.exitCode = 1;
});
