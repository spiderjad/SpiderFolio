// Metadatos de los modelos para forTenant. El tipo exige una entrada por cada modelo de
// Prisma (un modelo nuevo no compila hasta agregarlo) y un test compara alcance y relaciones
// con schema.prisma.
import type { Prisma } from "../generated/prisma/client.ts";

/**
 * global: sin tenant (User, Session…); solo desde servicios con el cliente base.
 * tenant: con workspaceId; forTenant filtra por esa columna.
 * workspace: el propio Workspace; forTenant filtra por id.
 */
export type ModelScope = "global" | "tenant" | "workspace";

export interface ModelMeta {
  scope: ModelScope;
  /** Campo de relación → modelo destino. */
  relations: Readonly<Record<string, Prisma.ModelName>>;
}

export const modelMetadata = {
  User: {
    scope: "global",
    relations: {
      sessions: "Session",
      authTokens: "AuthToken",
      memberships: "Membership",
      termsAcceptances: "TermsAcceptance",
      recoveryCodes: "RecoveryCode",
      trustedDevices: "TrustedDevice",
      oauthGrants: "OAuthGrant",
    },
  },
  TermsAcceptance: { scope: "global", relations: { user: "User" } },
  Session: { scope: "global", relations: { user: "User" } },
  AuthToken: { scope: "global", relations: { user: "User" } },
  RecoveryCode: { scope: "global", relations: { user: "User" } },
  TrustedDevice: { scope: "global", relations: { user: "User" } },
  RateLimitBucket: { scope: "global", relations: {} },
  SystemEmailHealth: { scope: "global", relations: {} },
  Workspace: {
    scope: "workspace",
    relations: {
      roles: "Role",
      memberships: "Membership",
      departments: "Department",
      departmentMembers: "DepartmentMember",
      invitations: "Invitation",
      auditLogs: "AuditLog",
      pinLogins: "PinLogin",
      spaces: "Space",
      nodes: "Node",
      permissions: "Permission",
      fileVersions: "FileVersion",
      uploadReservations: "UploadReservation",
      importJobs: "ImportJob",
      spaceStates: "SpaceUserState",
      downloadTokens: "DownloadToken",
      zipExports: "ZipExport",
      pageContents: "PageContent",
      pageImages: "PageImage",
      commentThreads: "CommentThread",
      comments: "Comment",
      mentions: "Mention",
      sharedSeen: "SharedSeen",
      notifications: "Notification",
      documentTypes: "DocumentType",
      controlledDocuments: "ControlledDocument",
      documentVersions: "DocumentVersion",
      approvals: "Approval",
      readRequirements: "ReadRequirement",
      readAcknowledgments: "ReadAcknowledgment",
      documentVisits: "DocumentVisit",
      qrCodes: "QrCode",
      emailSettings: "WorkspaceEmail",
      contentChunks: "ContentChunk",
      usageCounters: "UsageCounter",
      usageCounterMembers: "UsageCounterMember",
      bianLimits: "BianLimit",
      bianFeedback: "BianFeedback",
      license: "WorkspaceLicense",
      pluginSettings: "PluginSetting",
      pluginSecrets: "PluginSecret",
      externalIdentities: "ExternalIdentity",
      ssoFlows: "SsoFlow",
      oauthGrants: "OAuthGrant",
      fileTexts: "FileText",
    },
  },
  Role: {
    scope: "tenant",
    relations: { workspace: "Workspace", memberships: "Membership", invitations: "Invitation" },
  },
  Membership: {
    scope: "tenant",
    relations: {
      user: "User",
      workspace: "Workspace",
      role: "Role",
      departments: "DepartmentMember",
      pinLogin: "PinLogin",
      permissions: "Permission",
      spaceStates: "SpaceUserState",
      downloadTokens: "DownloadToken",
      externalIdentity: "ExternalIdentity",
    },
  },
  Department: {
    scope: "tenant",
    relations: {
      workspace: "Workspace",
      parent: "Department",
      children: "Department",
      members: "DepartmentMember",
      permissions: "Permission",
      spaces: "Space",
    },
  },
  DepartmentMember: {
    scope: "tenant",
    relations: { workspace: "Workspace", department: "Department", membership: "Membership" },
  },
  PinLogin: { scope: "tenant", relations: { workspace: "Workspace", membership: "Membership" } },
  Invitation: { scope: "tenant", relations: { workspace: "Workspace", role: "Role" } },
  Space: {
    scope: "tenant",
    relations: {
      workspace: "Workspace",
      department: "Department",
      nodes: "Node",
      permissions: "Permission",
      userStates: "SpaceUserState",
      notifications: "Notification",
    },
  },
  SpaceUserState: {
    scope: "tenant",
    relations: { workspace: "Workspace", space: "Space", membership: "Membership" },
  },
  Node: {
    scope: "tenant",
    relations: {
      workspace: "Workspace",
      space: "Space",
      parent: "Node",
      children: "Node",
      permissions: "Permission",
      versions: "FileVersion",
      pageContent: "PageContent",
      pageImages: "PageImage",
      threads: "CommentThread",
      mentions: "Mention",
      sharedSeen: "SharedSeen",
      notifications: "Notification",
      controlled: "ControlledDocument",
      documentVersions: "DocumentVersion",
      approvals: "Approval",
      readRequirements: "ReadRequirement",
      readAcknowledgments: "ReadAcknowledgment",
      documentVisits: "DocumentVisit",
      contentChunks: "ContentChunk",
      qrCodes: "QrCode",
      fileTexts: "FileText",
    },
  },
  FileVersion: { scope: "tenant", relations: { workspace: "Workspace", node: "Node" } },
  UploadReservation: { scope: "tenant", relations: { workspace: "Workspace" } },
  ImportJob: { scope: "tenant", relations: { workspace: "Workspace" } },
  DownloadToken: {
    scope: "tenant",
    relations: { workspace: "Workspace", membership: "Membership" },
  },
  ZipExport: { scope: "tenant", relations: { workspace: "Workspace" } },
  PageContent: { scope: "tenant", relations: { workspace: "Workspace", node: "Node" } },
  PageImage: { scope: "tenant", relations: { workspace: "Workspace", node: "Node" } },
  CommentThread: {
    scope: "tenant",
    relations: { workspace: "Workspace", node: "Node", comments: "Comment" },
  },
  Comment: { scope: "tenant", relations: { workspace: "Workspace", thread: "CommentThread" } },
  Mention: { scope: "tenant", relations: { workspace: "Workspace", node: "Node" } },
  DocumentVisit: { scope: "tenant", relations: { workspace: "Workspace", node: "Node" } },
  QrCode: { scope: "tenant", relations: { workspace: "Workspace", node: "Node" } },
  WorkspaceEmail: { scope: "tenant", relations: { workspace: "Workspace" } },
  BianFeedback: { scope: "tenant", relations: { workspace: "Workspace" } },
  WorkspaceLicense: { scope: "tenant", relations: { workspace: "Workspace" } },
  PluginSetting: { scope: "tenant", relations: { workspace: "Workspace" } },
  PluginSecret: { scope: "tenant", relations: { workspace: "Workspace" } },
  ExternalIdentity: {
    scope: "tenant",
    relations: { workspace: "Workspace", membership: "Membership" },
  },
  SsoFlow: { scope: "tenant", relations: { workspace: "Workspace" } },
  // The connector's OAuth (docs/spec/conector-mcp.md): clients and tokens are global (a client serves
  // every company; a token is found by its hash); a connection belongs to one company.
  OAuthClient: { scope: "global", relations: { grants: "OAuthGrant" } },
  OAuthGrant: {
    scope: "tenant",
    relations: {
      client: "OAuthClient",
      user: "User",
      workspace: "Workspace",
      tokens: "OAuthToken",
    },
  },
  OAuthToken: { scope: "global", relations: { grant: "OAuthGrant" } },
  ContentChunkDirty: { scope: "tenant", relations: {} },
  ContentChunk: { scope: "tenant", relations: { workspace: "Workspace", node: "Node" } },
  UsageCounter: { scope: "tenant", relations: { workspace: "Workspace" } },
  UsageCounterMember: { scope: "tenant", relations: { workspace: "Workspace" } },
  BianLimit: { scope: "tenant", relations: { workspace: "Workspace" } },
  FileText: { scope: "tenant", relations: { workspace: "Workspace", node: "Node" } },
  ReadRequirement: { scope: "tenant", relations: { workspace: "Workspace", node: "Node" } },
  ReadAcknowledgment: { scope: "tenant", relations: { workspace: "Workspace", node: "Node" } },
  Approval: { scope: "tenant", relations: { workspace: "Workspace", node: "Node" } },
  DocumentType: { scope: "tenant", relations: { workspace: "Workspace" } },
  ControlledDocument: { scope: "tenant", relations: { workspace: "Workspace", node: "Node" } },
  DocumentVersion: { scope: "tenant", relations: { workspace: "Workspace", node: "Node" } },
  Notification: {
    scope: "tenant",
    relations: { workspace: "Workspace", space: "Space", node: "Node" },
  },
  SharedSeen: { scope: "tenant", relations: { workspace: "Workspace", node: "Node" } },
  Permission: {
    scope: "tenant",
    relations: {
      workspace: "Workspace",
      space: "Space",
      node: "Node",
      membership: "Membership",
      department: "Department",
    },
  },
  AuditLog: { scope: "tenant", relations: { workspace: "Workspace" } },
} as const satisfies Record<Prisma.ModelName, ModelMeta>;

export type ModelName = keyof typeof modelMetadata;

export function relationsOf(model: ModelName): Readonly<Record<string, ModelName>> {
  return modelMetadata[model].relations;
}
