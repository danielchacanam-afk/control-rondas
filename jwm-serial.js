const JWM_USB_FILTER = { usbVendorId: 0x10c4, usbProductId: 0xea60 };

function jwmFrame(payload) {
  const checksum = payload.reduce((sum, byte) => (sum + byte) & 0xffff, 0);
  return Uint8Array.of(
    0xd5, 0xd5, payload.length & 0xff, payload.length >> 8,
    ...payload, checksum & 0xff, checksum >> 8, 0x0d, 0x0a
  );
}

async function withJwmReader(operation) {
  if (!navigator.serial) throw new Error('Abre esta página en Chrome o Edge de escritorio.');
  const port = await navigator.serial.requestPort({ filters: [JWM_USB_FILTER] });
  await port.open({ baudRate: 57600, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none' });
  let bytes = [];
  try {
    await port.setSignals({ dataTerminalReady: true, requestToSend: true });

    async function exchange(payload, responseOpcode, timeoutMs = 1800) {
      const writer = port.writable.getWriter();
      try {
        await writer.write(jwmFrame(payload));
      } finally {
        writer.releaseLock();
      }

      let expired = false;
      let reader;
      const timeout = setTimeout(() => {
        expired = true;
        reader?.cancel().catch(() => {});
      }, timeoutMs);
      try {
        while (!expired && port.readable) {
          reader = port.readable.getReader();
          try {
            while (!expired) {
              while (bytes.length >= 4) {
                if (bytes[0] !== 0xd5 || bytes[1] !== 0xd5) {
                  bytes.shift();
                  continue;
                }
                const length = bytes[2] | (bytes[3] << 8);
                if (!length || length > 8192) {
                  bytes.shift();
                  continue;
                }
                if (bytes.length < length + 8) break;
                const frame = bytes.splice(0, length + 8);
                const data = frame.slice(4, 4 + length);
                const checksum = data.reduce((sum, byte) => (sum + byte) & 0xffff, 0);
                if (frame[length + 4] === (checksum & 0xff) &&
                    frame[length + 5] === (checksum >> 8) &&
                    frame[length + 6] === 0x0d && frame[length + 7] === 0x0a &&
                    data[0] === responseOpcode) return data;
              }
              const result = await reader.read();
              if (result.done) break;
              for (const byte of result.value) bytes.push(byte);
            }
          } catch (error) {
            // Chrome can replace its readable stream after a serial line BREAK.
            if (error.name !== 'BreakError' && !/break received/i.test(error.message)) throw error;
            bytes = [];
            continue;
          } finally {
            reader.releaseLock();
            reader = null;
          }
          break;
        }
      } finally {
        clearTimeout(timeout);
      }
      throw new Error('El lector JWM no respondió a tiempo.');
    }

    await exchange([0x0a], 0x8a);
    const identity = await exchange([0x02], 0x82);
    if (identity.length !== 3) throw new Error('El lector devolvió una identificación inválida.');
    return await operation({ serial: String(identity[1] | (identity[2] << 8)), exchange });
  } finally {
    await port.close();
  }
}
