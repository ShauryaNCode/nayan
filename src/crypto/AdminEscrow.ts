import {EmbeddingCrypto} from './EmbeddingCrypto';
import {unwrapDEKWithAdminPrivateKey} from './RSAOAEP';
import {
  base64ToFloat32,
  bytesToHex,
} from '../utils/BufferUtils';

export type AdminEscrowRecoverParams = {
  personnelId: string;
  kek_admin_wrapped: string;
  encrypted_embed: string;
  adminPrivateKeyPEM: string;
};

export const AdminEscrow = {
  async recoverEmbedding(
    params: AdminEscrowRecoverParams,
  ): Promise<Float32Array> {
    console.warn(
      '[ADMIN ESCROW - DEMO ONLY] Recovering an embedding with the enterprise private key.',
    );

    const dek = await unwrapDEKWithAdminPrivateKey(
      params.kek_admin_wrapped,
      params.adminPrivateKeyPEM,
    );
    let dekHex = bytesToHex(dek);

    try {
      const plaintextBase64 = await EmbeddingCrypto.decrypt(
        params.encrypted_embed,
        params.personnelId,
        dekHex,
      );
      return base64ToFloat32(plaintextBase64);
    } finally {
      dek.fill(0);
      dekHex = ''.padStart(64, '0');
      void dekHex;
    }
  },
};
