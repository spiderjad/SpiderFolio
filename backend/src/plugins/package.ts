// Signed plugin packages (.sfplugin, docs/spec/plugins.md «Subir un plugin desde la app»): a gzipped
// ustar tar with manifest.json, manifest.sig and the built plugin under package/. Everything is checked
// in memory before anything touches the disk: size limits, safe paths, SpiderJAD's Ed25519 signature
// over the manifest, the hash of every file, the plugin's own manifest and the license it brings, which
// has to include the plugin and belong to the company that uploads it.
import { createHash, createPublicKey, verify, type KeyObject } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { pluginPackageLimits } from "@spiderfolio/limits";
import {
  fromBase64Url,
  PACKAGE_FILES_PREFIX,
  PACKAGE_MANIFEST_FILE,
  PACKAGE_SIGNATURE_FILE,
  PLUGIN_API_VERSION,
  PluginManifestSchema,
  PluginPackageManifestSchema,
  type LicensePayload,
  type PluginManifest,
  type PluginPackageManifest,
} from "@spiderfolio/plugin-sdk";
import { verifyLicense } from "./license.ts";
import { PACKAGE_PUBLIC_KEY_PEM } from "./package-key.ts";

const defaultKey = createPublicKey(PACKAGE_PUBLIC_KEY_PEM);

export type PackageRejection =
  | "format"
  | "tooLarge"
  | "signature"
  | "tampered"
  | "manifest"
  | "unsupported"
  | "license"
  | "licenseExpired"
  | "licenseWorkspace";

export class PackageError extends Error {
  readonly reason: PackageRejection;
  constructor(reason: PackageRejection, detail?: string) {
    super(detail ?? reason);
    this.name = "PackageError";
    this.reason = reason;
  }
}

export interface VerifiedPackage {
  manifest: PluginPackageManifest;
  /** The plugin's own manifest (package/package.json). */
  plugin: PluginManifest;
  license: LicensePayload;
  /** Files under package/, by their path relative to it. */
  files: ReadonlyMap<string, Buffer>;
}

export interface VerifyPackageOptions {
  workspaceId: string;
  now?: Date;
  /** Tests only: other keys. */
  packageKey?: KeyObject;
  licenseKey?: KeyObject;
}

const BLOCK = 512;

/** A safe relative path: no absolute paths, «..», backslashes, drive letters or odd characters. */
function safePath(path: string): boolean {
  return (
    /^[A-Za-z0-9._@+-]+(\/[A-Za-z0-9._@+-]+)*$/u.test(path) &&
    !path.split("/").some((part) => part === "." || part === "..")
  );
}

function field(header: Buffer, offset: number, length: number): string {
  const raw = header.subarray(offset, offset + length);
  const end = raw.indexOf(0);
  return raw.subarray(0, end === -1 ? length : end).toString("utf8");
}

function octal(header: Buffer, offset: number, length: number): number {
  const text = field(header, offset, length).trim();
  if (!/^[0-7]+$/u.test(text)) throw new PackageError("format", "Número inválido en la cabecera");
  return Number.parseInt(text, 8);
}

/**
 * Regular files of a ustar archive. Directories are skipped; links, devices, PAX and GNU extensions are
 * refused (the packaging tool never writes them), and so are repeated paths.
 */
export function readTar(tar: Buffer): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  let offset = 0;
  let total = 0;
  while (offset + BLOCK <= tar.length) {
    const header = tar.subarray(offset, offset + BLOCK);
    if (header.every((byte) => byte === 0)) return files;
    if (field(header, 257, 6) !== "ustar") throw new PackageError("format", "No es ustar");
    const expected = octal(header, 148, 8);
    let sum = 0;
    for (let index = 0; index < BLOCK; index += 1) {
      sum += index >= 148 && index < 156 ? 32 : (header[index] ?? 0);
    }
    if (sum !== expected) throw new PackageError("format", "Suma de la cabecera");
    const prefix = field(header, 345, 155);
    const name = field(header, 0, 100);
    const path = prefix === "" ? name : `${prefix}/${name}`;
    const type = String.fromCharCode(header[156] ?? 0);
    const size = octal(header, 124, 12);
    offset += BLOCK;
    if (type === "5") {
      offset += Math.ceil(size / BLOCK) * BLOCK;
      continue;
    }
    if (type !== "0" && type !== "\0")
      throw new PackageError("format", `Entrada no admitida: ${path}`);
    if (!safePath(path)) throw new PackageError("format", `Ruta no admitida: ${path}`);
    if (files.has(path)) throw new PackageError("format", `Ruta repetida: ${path}`);
    if (offset + size > tar.length) throw new PackageError("format", "Archivo cortado");
    total += size;
    if (
      files.size + 1 > pluginPackageLimits.maxFiles ||
      total > pluginPackageLimits.maxUnpackedBytes
    ) {
      throw new PackageError("tooLarge");
    }
    files.set(path, Buffer.from(tar.subarray(offset, offset + size)));
    offset += Math.ceil(size / BLOCK) * BLOCK;
  }
  throw new PackageError("format", "Falta el final del archivo");
}

const sha256 = (data: Buffer) => createHash("sha256").update(data).digest("hex");

/** Verifies a .sfplugin for the company that uploads it. Throws PackageError with the reason. */
export function verifyPackage(file: Buffer, options: VerifyPackageOptions): VerifiedPackage {
  if (file.length > pluginPackageLimits.maxBytes) throw new PackageError("tooLarge");
  let tar: Buffer;
  try {
    tar = gunzipSync(file, { maxOutputLength: pluginPackageLimits.maxUnpackedBytes + 1024 * 1024 });
  } catch (error) {
    if (error instanceof RangeError) throw new PackageError("tooLarge");
    throw new PackageError("format", "No es gzip");
  }
  const entries = readTar(tar);

  // Signature over the manifest's bytes, as they are.
  const manifestBytes = entries.get(PACKAGE_MANIFEST_FILE);
  const signatureText = entries.get(PACKAGE_SIGNATURE_FILE)?.toString("utf8").trim();
  if (manifestBytes === undefined || signatureText === undefined) {
    throw new PackageError("format", "Falta el manifiesto o la firma");
  }
  const signature = fromBase64Url(signatureText);
  const key = options.packageKey ?? defaultKey;
  if (
    signature?.length !== 64 ||
    key.asymmetricKeyType !== "ed25519" ||
    !verify(null, manifestBytes, key, signature)
  ) {
    throw new PackageError("signature");
  }
  let manifest: PluginPackageManifest;
  try {
    manifest = PluginPackageManifestSchema.parse(JSON.parse(manifestBytes.toString("utf8")));
  } catch {
    throw new PackageError("manifest", "Manifiesto del paquete");
  }

  // Exactly the signed files, byte for byte: nothing missing, nothing added.
  const files = new Map<string, Buffer>();
  for (const listed of manifest.files) {
    const data = entries.get(PACKAGE_FILES_PREFIX + listed.path);
    if (data?.length !== listed.size || sha256(data) !== listed.sha256) {
      throw new PackageError("tampered", listed.path);
    }
    files.set(listed.path, data);
  }
  const known = new Set([
    PACKAGE_MANIFEST_FILE,
    PACKAGE_SIGNATURE_FILE,
    ...manifest.files.map((listed) => PACKAGE_FILES_PREFIX + listed.path),
  ]);
  for (const path of entries.keys()) {
    if (!known.has(path)) throw new PackageError("tampered", path);
  }

  // The plugin's own manifest has to match the signed one.
  let plugin: PluginManifest;
  let version: unknown;
  try {
    const pkg = JSON.parse(files.get("package.json")?.toString("utf8") ?? "") as {
      version?: unknown;
      spiderfolio?: unknown;
    };
    plugin = PluginManifestSchema.parse(pkg.spiderfolio);
    version = pkg.version;
  } catch {
    throw new PackageError("manifest", "package.json");
  }
  if (
    plugin.id !== manifest.id ||
    version !== manifest.version ||
    plugin.distribution !== "commercial"
  ) {
    throw new PackageError("manifest", "No coincide con el manifiesto firmado");
  }
  if (plugin.pluginApi > PLUGIN_API_VERSION) throw new PackageError("unsupported");

  // The license: valid, including this plugin and for this company (always named in a package).
  const status = verifyLicense(manifest.license, {
    workspaceId: options.workspaceId,
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.licenseKey === undefined ? {} : { publicKey: options.licenseKey }),
  });
  if (status.state === "invalid" && status.reason === "workspace") {
    throw new PackageError("licenseWorkspace");
  }
  if (status.state === "expired") throw new PackageError("licenseExpired");
  if (status.state !== "valid" || !status.payload.plugins.includes(manifest.id)) {
    throw new PackageError("license");
  }
  if (status.payload.workspaceId !== options.workspaceId)
    throw new PackageError("licenseWorkspace");
  return { manifest, plugin, license: status.payload, files };
}
