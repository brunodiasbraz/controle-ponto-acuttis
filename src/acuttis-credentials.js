import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { closeSync, chmodSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { saveSetting, setting } from "./db.js";

const configRoot = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
const keyFile = resolve(configRoot, "controle-ponto-acuttis", "credential.key");
const credentialSetting = "acuttis_credentials_v1";

function encryptionKey() {
  mkdirSync(dirname(keyFile), { recursive: true, mode: 0o700 });
  let descriptor;
  try {
    descriptor = openSync(keyFile, "wx", 0o600);
    writeFileSync(descriptor, randomBytes(32));
    closeSync(descriptor);
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    if (error.code !== "EEXIST") throw error;
  }
  chmodSync(keyFile, 0o600);
  const key = readFileSync(keyFile);
  if (key.length !== 32) throw new Error("A chave local de criptografia do Acuttis é inválida.");
  return key;
}

function encrypt(value) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString("base64url")).join(".");
}

function decrypt(value) {
  const [encodedIv, encodedTag, encodedCiphertext] = value.split(".");
  if (!encodedIv || !encodedTag || !encodedCiphertext) throw new Error("As credenciais salvas do Acuttis estão inválidas.");
  try {
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(encodedIv, "base64url"));
    decipher.setAuthTag(Buffer.from(encodedTag, "base64url"));
    const plaintext = Buffer.concat([decipher.update(Buffer.from(encodedCiphertext, "base64url")), decipher.final()]).toString("utf8");
    return JSON.parse(plaintext);
  } catch {
    throw new Error("Não foi possível descriptografar as credenciais do Acuttis. Verifique se o arquivo de chave local existe e não foi substituído.");
  }
}

export function getAcuttisCredentials(userId) {
  const stored = setting(userId, credentialSetting, "");
  return stored ? decrypt(stored) : null;
}

export function saveAcuttisCredentials(userId, username, password) {
  saveSetting(userId, credentialSetting, encrypt({ username, password }));
}

export function deleteAcuttisCredentials(userId) {
  saveSetting(userId, credentialSetting, "");
}
