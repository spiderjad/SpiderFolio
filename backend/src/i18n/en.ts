// Backend texts in US English. Same shape as es.ts (the reference catalog), checked by Catalog.
// The contract with the app is the error code; the message is for people.
import type { Catalog } from "./catalog.ts";
import type * as Es from "./es.ts";

export const errorMessages: Catalog<typeof Es.errorMessages> = {
  VALIDATION_ERROR: "The data you sent isn't valid.",
  BAD_REQUEST: "The request isn't valid.",
  UNAUTHENTICATED: "Your session isn't valid or has expired. Sign in again.",
  INVALID_CREDENTIALS: "Wrong email or password.",
  INVALID_TOKEN: "The link isn't valid or has expired. Request a new one.",
  FORBIDDEN: "You don't have permission to do this.",
  MFA_INVALID_CODE: "The code is wrong or has already been used.",
  MFA_SETUP_REQUIRED:
    "Your company requires two-step verification. Turn it on in your profile to continue.",
  DIRECTORY_SIGN_IN_REQUIRED:
    "Your company signs people in with their work account. Sign out and sign in with it.",
  MFA_RECENT_REQUIRED: "To do this, confirm the code from your authenticator app again.",
  LIMIT_REACHED: "You reached a limit set by your company. An admin can change it.",
  NOT_FOUND: "We couldn't find what you're looking for.",
  CONFLICT: "This operation conflicts with existing data.",
  PAYLOAD_TOO_LARGE: "The request is too large.",
  RATE_LIMITED: "Too many attempts. Wait a few minutes and try again.",
  UNAVAILABLE: "The service isn't available right now.",
  INTERNAL: "Something went wrong. We're already looking into it.",
};

/** Specific messages that replace the generic one for their code. */
export const specificErrorMessages: Catalog<typeof Es.specificErrorMessages> = {
  emailTaken:
    "We couldn't create the account with that email. " +
    "If you already have one, sign in or reset your password.",
};

export const emailTexts: Catalog<typeof Es.emailTexts> = {
  footer:
    "You received this email because you have a SpiderFolio account. " +
    "If you don't recognize this activity, reply to this message.",
  linkFallback: "If the button doesn't work, copy this link into your browser:",
  someone: "Someone",
  yourCompany: "your company",
  deviceJoin: " on ",
  verifyEmail: {
    subject: "Confirm your email on SpiderFolio",
    title: "Confirm your email",
    greeting: (name: string) => `Hi ${name},`,
    body: "To finish activating your account, confirm that this email is yours.",
    action: "Confirm email",
    expiry:
      "The link expires in 24 hours. " +
      "If you didn't create a SpiderFolio account, ignore this email.",
  },
  resetPassword: {
    subject: "Reset your SpiderFolio password",
    title: "Reset your password",
    greeting: (name: string) => `Hi ${name},`,
    body: "We received a request to reset your account password.",
    action: "Choose a new password",
    expiry:
      "The link expires in 1 hour and works only once. " +
      "If you didn't request it, ignore this email: your password stays the same.",
  },
  newLogin: {
    subject: "New sign-in to SpiderFolio",
    title: "New sign-in",
    greeting: (name: string) => `Hi ${name},`,
    body: (device: string, when: string) =>
      `Someone signed in to your account from a new device (${device}) on ${when} (UTC).`,
    warning:
      "If it was you, you don't need to do anything. " +
      "If not, change your password and sign out of your other sessions from your profile.",
    unknownDevice: "unknown device",
  },
  mfaEnabled: {
    subject: "You turned on two-step verification",
    title: "Two-step verification turned on",
    greeting: (name: string) => `Hi ${name},`,
    body:
      "From now on, when you sign in to SpiderFolio we'll also ask for the code from your " +
      "authenticator app. Keep your recovery codes somewhere safe.",
    warning:
      "If it wasn't you, change your password right away " +
      "and let us know by replying to this email.",
  },
  mfaDisabled: {
    subject: "You turned off two-step verification",
    title: "Two-step verification turned off",
    greeting: (name: string) => `Hi ${name},`,
    body:
      "Your account no longer asks for the authenticator app code when you sign in. " +
      "Your recovery codes and trusted devices are no longer valid.",
    warning:
      "If it wasn't you, change your password right away, turn it back on, " +
      "and let us know by replying to this email.",
  },
  mfaReset: {
    subject: "Your two-step verification was reset",
    title: "Your two-step verification was reset",
    greeting: (name: string) => `Hi ${name},`,
    body: (workspace: string) =>
      `An admin of ${workspace} reset two-step verification on your account and we signed you ` +
      "out of your sessions. Next time you sign in, you can set it up again with your " +
      "authenticator app.",
    warning: "If you didn't ask for this, tell your admin and change your password right away.",
  },
  passwordChanged: {
    subject: "Your SpiderFolio password changed",
    title: "You changed your password",
    greeting: (name: string) => `Hi ${name},`,
    body: "Your account password was changed and we signed you out of your other sessions.",
    warning:
      "If it wasn't you, reset your password right away and let us know by replying to this email.",
  },
};

/** Role and capability rules (9.1 and 9.2). */
export const roleMessages: Catalog<typeof Es.roleMessages> = {
  baseNotAllowed: "You can't create a role with that base level.",
  guestWithCapabilities: "A guest role can't have admin capabilities.",
  capabilitiesNotHeld: (missing: readonly string[]) =>
    `You can't grant capabilities you don't have: ${missing.join(", ")}.`,
  systemRole: "System roles can't be changed or deleted.",
  roleAboveYou: "This role grants more power than you have: you can't change or delete it.",
  nameTaken: "A role with that name already exists.",
  inUse: (members: number, invitations: number) =>
    `This role is in use (members: ${String(members)}, pending invitations: ` +
    `${String(invitations)}). Change it before deleting it.`,
  readersCannotAdminister:
    "Some readers have this role, and a reader can't have admin capabilities.",
  guestsNeedReaderSeat:
    "Some members with a full seat have this role, and a guest is always a reader.",
};

/** Departments (9.3). */
export const positionMessages: Catalog<typeof Es.positionMessages> = {
  nameTaken: "There's already a position with that name.",
};

export const departmentMessages: Catalog<typeof Es.departmentMessages> = {
  nameTaken: "A department with that name already exists.",
  parentCycle: "A department can't be inside itself or one of its subdepartments.",
  managerNotActive: "The head has to be an active member of the workspace.",
  moveToSame: "This person is already in that department.",
  leaderCannotTouch:
    "As a department head, you can't manage people with a role equal to or above yours, " +
    "or yourself.",
  guestsHaveNoDepartments:
    "An external guest only sees what is explicitly shared with them: they don't join departments.",
};

export const invitationMessages: Catalog<typeof Es.invitationMessages> = {
  verifyEmailFirst: "Confirm your email to invite your team.",
  ownerRole: "You can't invite someone with the owner role: ownership is transferred.",
  roleAboveYou: "You can't invite with a role that grants more power than you have.",
  guestMustBeReader: "An external guest always takes a reader seat.",
  leaderOwnAreaOnly: "You can only invite to the departments you lead and their subareas.",
  readerCannotAdminister: "A reader can't have a role with admin capabilities.",
  guestsHaveNoDepartments:
    "An external guest only sees what is explicitly shared with them: they don't join departments.",
  domainNotAllowed: "These emails aren't from a domain allowed for invitations.",
  alreadyHasAccount: "This email already has an account: sign in and open the link again.",
  wrongAccount: "This invitation is for a different email. Sign in with the invited account.",
  detailsRequired: "Enter your name and choose a password to create your account.",
  termsRequired: "You must accept the Terms and conditions and the Privacy policy.",
  notPending: "This invitation is no longer available.",
};

export const invitationEmailTexts: Catalog<typeof Es.invitationEmailTexts> = {
  subject: (workspace: string) => `You're invited to ${workspace}`,
  title: (workspace: string) => `You're invited to ${workspace}`,
  greeting: "Hi,",
  someone: "Someone on your team",
  body: (inviter: string, workspace: string, role: string) =>
    `${inviter} invited you to ${workspace} with the ${role} role.`,
  action: "Accept invitation",
  expiry:
    "The link expires in 7 days. If you weren't expecting this invitation, ignore this email.",
};

/** You were @mentioned on a page or in a comment. */
export const mentionEmailTexts: Catalog<typeof Es.mentionEmailTexts> = {
  subject: (who: string) => `${who} mentioned you`,
  title: (who: string) => `${who} mentioned you`,
  greeting: (name: string) => `Hi ${name},`,
  inPage: (who: string, page: string) => `${who} mentioned you in the text of “${page}”.`,
  inComment: (who: string, page: string) => `${who} mentioned you in a comment on “${page}”.`,
  action: "Open the page",
  footnote: "You're getting this notice because you have access to the page.",
};

/** You were given direct access to something (space, folder, file or page). */
export const sharedEmailTexts: Catalog<typeof Es.sharedEmailTexts> = {
  subject: (who: string, what: string) => `${who} shared “${what}” with you`,
  title: (who: string) => `${who} shared something with you`,
  greeting: (name: string) => `Hi ${name},`,
  body: (who: string, what: string, level: string) =>
    `${who} gave you access to “${what}” with permission to ${level}.`,
  levels: { VIEW: "view", COMMENT: "comment", EDIT: "edit", MANAGE: "manage" },
  action: "Open",
  footnote: "You're getting this notice because you now have access.",
};

/** Controlled document notices (approvals). */
export const documentNoticeTexts: Catalog<typeof Es.documentNoticeTexts> = {
  greeting: (name: string) => `Hi ${name},`,
  approval_pending: {
    subject: (what: string) => `Approval pending: ${what}`,
    title: "You have a document to approve",
    body: (who: string, what: string, code: string, version: number) =>
      `${who} asked you to approve “${what}” (${code}, version ${String(version)}).`,
    action: "Review the document",
  },
  approval_approved: {
    subject: (what: string) => `Approved: ${what}`,
    title: "Your document was approved",
    body: (what: string, code: string, version: number) =>
      `“${what}” (${code}, version ${String(version)}) was approved and can now be published.`,
    action: "Open the document",
  },
  approval_rejected: {
    subject: (what: string) => `Rejected: ${what}`,
    title: "Your document was rejected",
    body: (what: string, code: string, version: number) =>
      `“${what}” (${code}, version ${String(version)}) was rejected and that version was ` +
      "discarded. Check the reason and create a new one.",
    action: "Open the document",
  },
  approval_changes: {
    subject: (what: string) => `Changes requested: ${what}`,
    title: "Changes were requested on your document",
    body: (who: string, what: string, code: string, version: number) =>
      `${who} requested changes on “${what}” (${code}, version ${String(version)}). ` +
      "It's a draft again: review the comments and submit it again.",
    action: "Open the document",
  },
  reading_required: {
    subject: (what: string) => `Reading required: ${what}`,
    title: "You have a document to read",
    body: (who: string, what: string, code: string, version: number, due: string | null) =>
      `${who} asked you to read “${what}” (${code}, version ${String(version)}).` +
      (due === null ? "" : ` Due: ${due}.`),
    action: "Read and confirm",
  },
  reading_reminder: {
    subject: (what: string) => `Reading reminder: ${what}`,
    title: "You still need to read a document",
    body: (_who: string, what: string, code: string, version: number, due: string | null) =>
      `You haven't confirmed reading “${what}” (${code}, version ${String(version)}) yet.` +
      (due === null ? "" : ` Due: ${due}.`),
    action: "Read and confirm",
  },
  reading_overdue_leader: {
    subject: (what: string) => `Overdue reading in your area: ${what}`,
    title: "A reading in your area is overdue",
    body: (who: string, what: string, code: string, version: number, due: string | null) =>
      `${who} hasn't confirmed reading “${what}” (${code}, version ${String(version)}).` +
      (due === null ? "" : ` It was due ${due}.`),
    action: "View the document",
  },
  footnote: "You're getting this notice because you have access to the document.",
};

/** Email change requested by the person themselves. */
export const emailChangeTexts: Catalog<typeof Es.emailChangeTexts> = {
  confirm: {
    subject: "Confirm your new email",
    title: "Confirm your new email",
    greeting: (name: string) => `Hi ${name},`,
    body:
      "You asked to use this address as your account email. " +
      "Confirm it so it replaces the previous one.",
    action: "Confirm the email",
    expiry:
      "The link expires in 24 hours. If you didn't request it, ignore this email: " +
      "your account stays the same.",
  },
  notice: {
    subject: "Someone asked to change your account email",
    title: "Someone asked to change your account email",
    greeting: (name: string) => `Hi ${name},`,
    body: (next: string) =>
      `Someone asked to change your account email to ${next}. ` +
      "It won't change until it's confirmed from that address.",
    warning: "If it wasn't you, change your password now.",
  },
};

/** Large ZIP export (9.3): the notice with the temporary link. */
export const exportEmailTexts: Catalog<typeof Es.exportEmailTexts> = {
  ready: {
    subject: "Your ZIP is ready",
    title: "Your ZIP is ready",
    greeting: (name: string) => `Hi ${name},`,
    body: (fileName: string, size: string) =>
      `You can now download ${fileName} (${size}). You requested it from Files.`,
    action: "Download the ZIP",
    expiry: (days: number) =>
      `The link works for ${String(days)} ${days === 1 ? "day" : "days"} and only while ` +
      "you're still part of the team.",
  },
  failed: {
    subject: "We couldn't create your ZIP",
    title: "We couldn't create your ZIP",
    greeting: (name: string) => `Hi ${name},`,
    body: (fileName: string, reason: string) => `We couldn't create ${fileName}. ${reason}`,
    retry: "You can request it again from Files, maybe in smaller parts.",
  },
};

/** Members (9.3). */
/** Headers and values of the exported members CSV. */
export const memberExportLabels: Catalog<typeof Es.memberExportLabels> = {
  name: "Name",
  email: "Email",
  loginName: "Username",
  jobTitle: "Job title",
  role: "Role",
  seat: "Seat",
  status: "Status",
  departments: "Departments",
  lastSeen: "Last access",
  createdAt: "Added",
  seats: { FULL: "Full", READER: "Reader" },
  statuses: { ACTIVE: "Active", SUSPENDED: "Suspended" },
};

/** Username + PIN for shop-floor readers (7.6). */
export const pinMessages: Catalog<typeof Es.pinMessages> = {
  invalidCredentials: "Wrong username or PIN.",
  roleNotAllowed: "A person with a PIN can only have a member role without admin capabilities.",
  weakPin: "That PIN is too easy to guess. Choose another one or generate one.",
  loginNameTaken: "Someone in this workspace already has that username.",
  loginNameInvalid:
    "The username must be 3 to 32 lowercase letters, numbers, periods, hyphens or underscores.",
  notPinMember: "This person doesn't sign in with a PIN.",
};

export const memberMessages: Catalog<typeof Es.memberMessages> = {
  identityShared:
    "This person has an account in other companies: only they can change their name or email.",
  emailAlreadyConfirmed:
    "They already confirmed their email: they change it themselves from their account.",
  pinHasNoEmail: "People who sign in with a username and PIN don't have an email.",
  emailTaken: "An account with that email already exists.",
  targetAboveYou: "You can't manage a person with a role above yours.",
  ownerRoleNotAssignable:
    "The owner role isn't assigned here: ownership is transferred from the settings.",
  lastOwner: "The workspace must have at least one active owner.",
  cannotActOnSelf: "You can't do this on your own account.",
  guestSeatMustBeReader: "An external guest always takes a reader seat.",
  administrativeSeatMustBeFull: "A role with admin capabilities needs a full seat.",
  readerCannotAdminister: "A reader can't have admin capabilities.",
  guestsHaveNoDepartments:
    "An external guest only sees what is explicitly shared with them: they don't join departments.",
  transferTargetInvalid: "The person receiving the content has to be a different active member.",
  alreadySuspended: "This person is already suspended.",
  notSuspended: "This person isn't suspended.",
  csvTooLarge: "The file has too many rows (500 max).",
  csvEmpty: "The file has no rows to import.",
  csvNoEmailColumn: "The email column is missing.",
};

/** Spaces, folders and files (module 3). */
export const contentMessages: Catalog<typeof Es.contentMessages> = {
  controlledPdfUnavailable:
    "This server doesn't generate the PDF for controlled pages (Gotenberg is missing). " +
    "Whoever manages the installation can turn it on.",
  untitledPage: "Untitled",
  controlledOnlyPagesFiles: "Only pages and files can be controlled documents.",
  controlledExists: "It's already a controlled document.",
  controlledLocked:
    "The document is in review or approved: it can't be changed until it's published " +
    "or sent back.",
  noPdfForVersion: "Only published or obsolete versions have a controlled PDF.",
  pdfOnly: "The controlled PDF exists for pages and PDF files.",
  nothingPublished: "There's no published version yet: publish it before asking people to read it.",
  typeExists: "A document type with that code already exists.",
  counterOnlyUp: "The counter can only go up: lowering it would repeat codes already used.",
  notControlled: "This item isn't a controlled document.",
  nothingToSubmit: "There's no draft to submit for review.",
  selfApprovalOff:
    "The person who submits a document can't approve it (self-approval is turned off).",
  approverNotEligible:
    "Only people who have permission to approve this document and can see it can approve it.",
  notInReview: "The document isn't in review.",
  notApproved: "The document isn't approved yet.",
  rejectNeedsComment: "Explain why you're rejecting it.",
  unknownDocType: "That document type doesn't exist.",
  copySuffix: "(copy)",
  pageTooLarge: "The page is too large. Split it in two.",
  pageInvalid: "The page content isn't valid.",
  pageUnsafe: "The page has a link that isn't allowed (only http, https and email).",
  pageForeignImage: "The page uses an image that doesn't belong to it.",
  pageConflict: "Someone else saved changes to this page while you were editing it.",
  spaceNameTaken: "A space with that name already exists.",
  nameTaken: "Something with that name already exists in this folder.",
  parentNotFolder: "The destination has to be a folder.",
  tooDeep: "Folders can't be nested that deep.",
  moveIntoItself: "You can't move a folder into itself or one of its subfolders.",
  spaceArchived: "The space is archived: it's read-only.",
  subjectRequired: "Choose a department, a person or the whole company (only one).",
  companyName: "Whole company",
  companyLevel: "The whole company can be given View, Comment or Edit.",
  limitedLevel: "Readers and external guests can't edit or manage: choose View or Comment.",
  memberNotActive: "The person has to be an active member.",
  expiryInPast: "The expiry date has to be in the future.",
  noChanges: "There's nothing to change.",
  lockout: "You can't remove the access that lets you manage this.",
  tooManyLevels: "Too many folder levels.",
  threadResolved: "The thread is resolved: reopen it to reply.",
  compareOnlyPages: "Only pages can be compared.",
  pdfUnreadable: "The PDF couldn't be read (is it protected?).",
};

/** File uploads and downloads (module 3). */
export const fileMessages: Catalog<typeof Es.fileMessages> = {
  unsupportedType:
    "This file type isn't allowed. Accepted types: PDF, DOCX, XLSX, PPTX, ODT, ODS, TXT, CSV, " +
    "PNG, JPG, WEBP and ZIP.",
  contentMismatch: "The file content doesn't match its type.",
  markup: "HTML and SVG files aren't allowed.",
  binaryText: "The text file isn't valid (it has binary data or isn't UTF-8).",
  notReceived: "The file didn't arrive complete. Try again.",
  sizeMismatch: "The file size doesn't match what was declared.",
  uploadExpired: "The upload expired. Start again.",
  partsIncomplete: "Some parts haven't been uploaded yet.",
  notAFile: "This isn't a file.",
  versionNotFound: "That version doesn't exist.",
  previewNotAllowed: "This file type can't be viewed in the browser: download it.",
  replaceNeedsFile: "Only a file can be replaced.",
  notAZip: "Only ZIP files can be imported.",
  selectionChanged:
    "The selection grew and can no longer be downloaded directly. Request it again.",
  zipTooBig: "The selection is too large for a single ZIP (3.9 GB max). Download it in parts.",
  zipNothing: "There are no files to download.",
  zipRequesterGone: "Whoever requested the ZIP is no longer part of the team.",
  zipFailed: "The ZIP couldn't be generated. Try again.",
  zipFileMissing:
    "One of the files is no longer available, so the ZIP couldn't be generated. Request it again.",
  importUnreadable: "The ZIP file couldn't be read. Is it damaged?",
  importSpaceGone: "The space is no longer available.",
  importZipGone: "The ZIP is no longer available.",
  importTargetGone: "The destination folder is no longer available.",
  importFolderFailed: "The folder couldn't be created.",
  importFolderName: "Import",
  pageImageTooLarge: "The image is larger than 10 MB.",
  profileImageTooLarge: "The image is larger than 5 MB.",
  imageInvalid: "The image isn't valid.",
  imageNotReceived: "The image didn't arrive.",
  imageMismatch: "The image isn't the one that was requested.",
  imageTypes: "Only JPG, PNG or WebP images are accepted.",
};

/** Company's own email sender (Security › Email). */
export const customEmailTexts: Catalog<typeof Es.customEmailTexts> = {
  keyMissing: "Custom senders aren't available on this server.",
  incomplete: "Fill in and save the settings before testing them.",
  domainSoon: "Sending from a verified domain will be available soon.",
  domainNotVerified: "Verify the domain's DNS records first.",
  invalidDomain: "Enter a valid domain, for example company.com.",
  noRecipient: "Your account doesn't have an email to receive the test.",
  needsPassword: "The SMTP server password is missing.",
  notTested: "Send a test email with these settings before turning them on.",
  invalidPort: "Use one of these ports: 25, 465, 587 or 2525.",
  hostNotFound: "The SMTP server wasn't found. Check the name.",
  hostPrivate: "The SMTP server must be public: internal addresses aren't allowed.",
  errors: {
    AUTH: "The server rejected the username or password.",
    CONNECTION:
      "Couldn't connect to the SMTP server. Check the server, the port and the security setting.",
    TLS: "Couldn't establish a secure connection (certificate or TLS).",
    SENDER_REJECTED: "The server rejected the sender or the recipient.",
    UNKNOWN: "The SMTP server returned an error while sending.",
  },
  fallbackFromName: (workspace: string) => `${workspace} (via SpiderFolio)`,
  alert: {
    subject: "Your company's emails were sent through SpiderFolio",
    title: "Your email server failed",
    body:
      "We couldn't send through your company's SMTP server. So nobody misses their notice, " +
      "those emails were sent with the SpiderFolio sender.",
    disabled:
      "After several failures in a row, we turned off the custom sender. " +
      "Check the settings and test them again to turn it back on.",
    action: "Review the email sender",
  },
  test: {
    subject: "SpiderFolio email sender test",
    title: "The sender works",
    body: (workspace: string) =>
      `This test email was sent with the SMTP server set up for ${workspace}. ` +
      "If you see it in your inbox, you can turn on the custom sender.",
  },
  systemTest: {
    subject: "SpiderFolio email test",
    title: "The server email works",
    body:
      "This test email was sent with the SMTP server set up for this installation (SMTP_HOST in " +
      ".env). If you see it in your inbox, verifications, invitations and notices will arrive.",
  },
};

/** Bian, the AI assistant: friendly, clear voice. */
export const bianTexts: Catalog<typeof Es.bianTexts> = {
  noEvidence: "I couldn't find this in your documents.",
  /** When what's there is partial: the answer starts like this. */
  partialIntro: "Here's what I found in your documents:",
  /** And, when it applies, ends like this. */
  mayHaveMore: "There may be more information. Try other words or open the document.",
  suspiciousInstruction: (document: string) => `Possible suspicious instruction in ${document}`,
  unavailable: "Bian isn't available right now. Try again in a few minutes.",
  workspaceOff: "Bian is turned off in your company.",
  guestsOff: "Bian isn't enabled for guests.",
  refused: "I can't help you with this question. Try rephrasing it.",
  providerError: "Bian had a problem answering. This question didn't count toward your limit.",
  needsEdit: "To write with Bian, you need edit permission on that folder.",
  draftNotice:
    "Bian draft: review it before sharing. It may have mistakes, and anything missing is in " +
    "brackets for you to fill in.",
  draftFailed:
    "Bian couldn't put the draft together. This didn't count toward your limit; try again.",
  notADocument: "Bian works with pages and files, not folders.",
  notControlled: "“What changed” is for controlled documents, which have versions.",
  singleVersion: "This document has only one version: there's nothing to compare it with.",
  noChanges: "There are no changes between these versions.",
  noText:
    "I can't read the text of this document yet (for example, a scan or a file that isn't " +
    "a PDF or DOCX).",
  summaryTruncated: "The document is very long: I only summarized the first parts.",
  changesTruncated: "There were many changes: I explained the first ones.",
};

/** License and plugins (docs/spec/plugins.md). */
export const pluginTexts: Catalog<typeof Es.pluginTexts> = {
  licenseInvalid:
    "The license isn't valid. Copy the full text we sent you, unchanged, and try again.",
  licenseExpired: "That license has expired. Ask us for a new one to keep using the plugins.",
  notCommunity: "This plugin is activated by the license, not manually.",
  acceptRiskRequired:
    "To activate an unverified plugin you have to confirm that it has access to the server.",
  licenseOtherCompany:
    "That license belongs to another company. Ask us for your company's one with the ID shown on this screen.",
  uploadDisabled: "On this server plugins can't be uploaded from the app.",
  uploadNeedsMfa:
    "To upload a plugin you need two-step verification turned on (My profile › Security).",
  packageRejected: {
    format: "The file isn't a SpiderFolio plugin (.sfplugin) or it's damaged.",
    tooLarge: "The file is too large for a plugin.",
    signature:
      "The plugin's signature isn't valid: SpiderJAD didn't publish it or it was modified.",
    tampered: "The plugin was modified after it was signed.",
    manifest: "The plugin doesn't have a valid manifest.",
    unsupported: "This plugin needs a newer version of SpiderFolio. Update the server first.",
    license: "The license inside the plugin isn't valid or doesn't include it.",
    licenseExpired: "The license inside the plugin has expired.",
    licenseWorkspace: "The license inside the plugin belongs to another company.",
    downgrade: "A newer version of this plugin is already installed.",
    builtIn: "This plugin comes built into the server image: it's updated with the image.",
  },
  restartUnsupported:
    "This server doesn't restart on its own: restart the app and the worker on the server to load the plugins.",
  restartPending: "A restart is already scheduled.",
  removeBuiltIn: "This plugin comes built into the server image: it can't be removed from the app.",
  removeNotInstalled: "This plugin isn't one of those uploaded from the app.",
};

/** Validation (Zod) messages returned to the app in `details.issues`. */
export const validationMessages: Catalog<typeof Es.validationMessages> = {
  invalidCursor: "Invalid cursor",
  invalidName: "Invalid name",
  noChanges: "No changes",
  minimum: (value: number) => `Minimum ${String(value)}`,
  contentMissing: "Content is missing",
  pinFormat: "The PIN has 6 digits",
  termsRequired: "You must accept the Terms and conditions and the Privacy policy.",
  invalidTimeZone: "Invalid IANA time zone",
  uppercaseAndDigits: "Only uppercase letters and numbers",
  colorFormat: "Color in #rrggbb format",
  unknownCapability: "Unknown capability",
  invalidHost: "Invalid server",
  invalidLocalPart: "Invalid local part",
};

/** Your own account: password and email (My profile). */
export const accountMessages: Catalog<typeof Es.accountMessages> = {
  currentPasswordWrong: "Your current password isn't correct.",
  sameEmail: "That's already your email.",
  emailTaken: "There's already an account with that email.",
};

/** Sign-in with two-step verification. */
export const mfaLoginMessages: Catalog<typeof Es.mfaLoginMessages> = {
  challengeExpired: "Your sign-in expired. Enter your email and password again.",
};

/** Two-step verification (My profile). */
export const mfaMessages: Catalog<typeof Es.mfaMessages> = {
  unavailable: "Two-step verification isn't available on this server.",
  pinUsers: "Tablet (PIN) accounts don't use two-step verification.",
  alreadyEnabled: "Two-step verification is already on.",
  notEnabled: "Two-step verification isn't on.",
  noSetup: "First start the setup to get the QR code.",
  invalidCode: "The code isn't correct or was already used. Try the one your app is showing now.",
  locked: "Too many wrong codes. Wait 15 minutes and try again.",
  wrongPassword: "The password isn't correct.",
};

/** Resetting someone else's two-step verification (Members). */
export const mfaResetMessages: Catalog<typeof Es.mfaResetMessages> = {
  self: "For your own account, use My profile.",
  actorWithoutMfa:
    "Only an admin with two-step verification turned on can reset it for someone else.",
  notEnabled: "This person doesn't have two-step verification turned on.",
};

/** Controlled PDF: control sheet, footer and watermark (in the company's language). */
export const controlledPdfTexts: Catalog<typeof Es.controlledPdfTexts> = {
  sheetTitle: "Document control sheet",
  code: "Code",
  title: "Title",
  version: "Version",
  effective: "Effective from",
  elaboratedBy: "Prepared by",
  approvedBy: "Approved by",
  sheetNote:
    "This sheet is added on download. The original file stays unchanged in SpiderFolio; the " +
    "current version is always the one in the app.",
  pageFooter: (current: string, total: string) => `Page ${current} of ${total}`,
  watermark: (name: string, when: string) => `Uncontrolled copy · downloaded by ${name} on ${when}`,
  obsolete: "OBSOLETE",
};

/** Document QR codes. */
export const qrTexts: Catalog<typeof Es.qrTexts> = {
  onlyDocuments: "QR codes are for pages, files and forms.",
  formPrivateOnly: "A form's QR code is always private: filling it in needs signing in.",
  imageLabel: "QR code",
  imageFileName: (name: string) => `QR ${name}`,
  labelsFileName: (name: string) => `QR labels ${name}`,
};

/** CSV of the access reports and of “Who can see this”. */
export const accessExportLabels: Catalog<typeof Es.accessExportLabels> = {
  reportTitles: {
    "cut-inheritance": "Inheritance cut",
    "direct-people": "Direct access for people",
    guests: "Guest access",
    expiring: "Access expiring soon",
  },
  targetKinds: { space: "Space", FOLDER: "Folder", PAGE: "Page", FORM: "Form", FILE: "File" },
  subjectKinds: { person: "Person", department: "Department" },
  levels: { VIEW: "View", COMMENT: "Comment", EDIT: "Edit", MANAGE: "Manage" },
  reportHeaders: [
    "Type",
    "Item",
    "Space",
    "Recipient",
    "Recipient type",
    "Level",
    "Expires",
    "Granted on",
  ],
  reasons: {
    owner: "Owner",
    admin: "Admin",
    bypass: "Manages all content",
    leader: "Head or deputy",
    member: "Part of the department",
    grant: "Access granted",
    company: "Company space",
    visible: "Visible space",
  },
  whoHeaders: ["Person", "Job title", "Role", "Level", "Why"],
  whoFileName: (name: string) => `Who can access ${name}.csv`,
};

/** Audit log: list and CSV. */
export const auditExportLabels: Catalog<typeof Es.auditExportLabels> = {
  invalidCursor: "Invalid cursor.",
  tooMany: (max: string) => `There are more than ${max} events: narrow the dates to export.`,
  headers: ["Date (UTC)", "Person", "Email", "Action", "Type", "Item", "IP", "Details"],
  staff: "SpiderFolio team",
  fileName: "audit-log.csv",
};

/** CSV of a controlled document's reads. */
export const readingExportLabels: Catalog<typeof Es.readingExportLabels> = {
  headers: ["Person", "Status", "Read on", "Due date"],
  statuses: {
    read: "Read",
    pending: "Pending",
    overdue: "Overdue",
    noAccess: "No access to the document",
  },
  fileName: (code: string) => `Reads ${code}.csv`,
};

/** Bian admin: limits and usage CSV. */
export const bianAdminTexts: Catalog<typeof Es.bianAdminTexts> = {
  limitOnlyForLimitMode: "Only enter a number when the mode is “a number of questions”.",
  blockedOnlyPerson: "“No access” can only be given to a person.",
  subjectMissing: "Say who the limit applies to.",
  unlimited: "No limit",
  blocked: "No access",
  peopleHeaders: ["Person", "Departments", "Questions", "Limit"],
  departmentHeaders: ["Department", "People", "Questions", "Limit per person"],
  peopleFileName: (month: string) => `Bian usage by person ${month}.csv`,
  departmentsFileName: (month: string) => `Bian usage by department ${month}.csv`,
};

/** Data created with each company, in the language of whoever creates it. */
export const defaultDataTexts: Catalog<typeof Es.defaultDataTexts> = {
  roles: {
    OWNER: {
      name: "Owner",
      description:
        "Everything, including the plugin license, transferring ownership and deleting the workspace.",
    },
    ADMIN: {
      name: "Admin",
      description:
        "Everything administrative, except the plugin license and deleting the workspace.",
    },
    MEMBER: {
      name: "Member",
      description: "Uses content according to their departments and permissions.",
    },
    GUEST: { name: "Guest", description: "External: only what's explicitly shared." },
  },
  documentTypes: {
    PRC: "Procedure",
    INS: "Work instruction",
    FOR: "Form",
    POL: "Policy",
    MAN: "Manual",
  },
};

export const directorySignInTexts: Catalog<typeof Es.directorySignInTexts> = {
  invalidCredentials: "Wrong username or password.",
  unavailable: "This sign-in isn't available. Sign in with your email and password.",
  flowExpired: "Signing in took too long or was opened in another browser. Try again.",
  emailTaken:
    "There's already an account with your work account's email. Ask your company's owner to link it.",
  notAllowed: "Your work account doesn't have access to this company.",
  directoryOnlyNeedsOwner:
    "First, at least one owner has to be able to sign in with their password and two-step verification.",
  alreadyLinked: "That directory account is already linked to someone else.",
  memberAlreadyLinked: "That person is already linked to a directory account.",
  noEncryptionKey:
    "The server has no encryption key configured (EMAIL_ENCRYPTION_KEY): secrets can't be saved.",
  unknownRole: "That role doesn't exist in the company or is the owner role.",
  unknownDepartment: "Some of those departments don't exist in the company.",
};

export const formMessages: Catalog<typeof Es.formMessages> = {
  untitledForm: "Untitled form",
  notAForm: "This isn't a form.",
  templateChanged:
    "Someone changed this form while you were editing it. Reload to see the current version and make your changes again.",
  duplicateId: "Two fields or options have the same identifier.",
  rangeInverted: "The minimum can't be greater than the maximum.",
  unknownOption: "An option marked as non-conforming doesn't exist in the field.",
  notAFileField: "That field isn't a photo or a signature.",
  fileTooLarge: "The photo is over 10 MB.",
  signatureType: "The signature has to be a PNG image.",
  unknownVersion: "That version of the form doesn't exist.",
  answersInvalid: "Check the marked answers.",
  filesInvalid: "A photo or signature didn't upload properly. Add it again.",
  weekdaysRequired: "Choose at least one weekday.",
  assigneesRequired: "Choose at least one person or department to fill it in.",
  unknownPeople: "Some of those people or departments aren't in the company.",
  alreadyVoided: "That record is already voided.",
  pdfUnavailable:
    "This install doesn't make PDFs (Gotenberg is missing). Export a CSV or ask whoever runs it to turn it on.",
};

export const safetyTexts: Catalog<typeof Es.safetyTexts> = {
  space: {
    es: {
      name: "Occupational health and safety",
      description: "Risk assessments, PPE, training and accidents.",
    },
    latam: {
      name: "Occupational health and safety",
      description: "Risk assessments, PPE, training and accidents.",
    },
  },
  riskAssessmentType: "Risk assessment",
  emergencyPlanType: { es: "Emergency plan", latam: "Emergency plan" },
  emergencyRoles: {
    es: [
      "Emergency chief",
      "Intervention chief",
      "First response team",
      "Second response team",
      "First aid",
      "Evacuation",
    ],
    latam: [
      "Emergency coordinator",
      "Brigade leader",
      "First response brigade",
      "Firefighting brigade",
      "First aid brigade",
      "Evacuation brigade",
    ],
  },
  drills: {
    scenarios: {
      FIRE: "Fire",
      EVACUATION: "Evacuation",
      SPILL: "Chemical spill",
      AMMONIA: "Ammonia leak",
      OTHER: "Other emergency",
    },
    expiryWhat: "Yearly emergency drill",
    messages: {
      roleNameTaken: "There's already a role with that name in the team.",
      alreadyMember: "That person is already in that role.",
    },
  },
  committee: {
    name: { es: "Health and safety committee", latam: "Joint health and safety committee" },
    kinds: { ORDINARY: "Ordinary", EXTRAORDINARY: "Extraordinary" },
    roles: {
      es: {
        DELEGATE: "Prevention delegate",
        COMPANY_REP: "Company representative",
        ADVISOR: "Prevention technician (adviser)",
        SECRETARY: "Secretary",
      },
      latam: {
        DELEGATE: "Workers' representative",
        COMPANY_REP: "Employer's representative",
        ADVISOR: "Prevention adviser",
        SECRETARY: "Secretary",
      },
    },
    mandateWhat: (person: string) => `End of ${person}'s term`,
    meetingWhat: "Quarterly committee meeting",
    minutes: {
      title: (day: string) => `Minutes of the meeting on ${day}`,
      date: "Date",
      kind: "Type",
      attendees: "Attendees",
      noAttendees: "No attendees recorded.",
      agenda: "Agenda",
      noAgenda: "No agenda.",
      discussion: "Discussion",
      agreements: "Agreements",
    },
    messages: {
      alreadyMember: "That person is already in the committee.",
      notMember: "Attendees have to be committee members.",
      termOrder: "The end of the term can't be before its start.",
      minutesOutside: "The minutes have to be a page or a file in the module's space.",
      noSpace: "The module has no space: save the Prevention settings to create it.",
    },
  },
  examplePositions: [
    "Production operator",
    "Cold room operator",
    "Dispatch operator",
    "Maintenance technician",
    "Shift supervisor",
  ],
  incidentForm: {
    name: "Accident or incident",
    date: "Date",
    time: "Time (approximate)",
    place: "Place",
    person: "Person affected",
    personHelp: "Leave it empty if nobody was affected.",
    type: "Type",
    types: {
      baja: "Accident with sick leave",
      sin_baja: "Accident without sick leave",
      incidente: "Incident (property damage)",
      casi: "Near miss",
    },
    severity: "Severity",
    severityHelp: "Only if someone was hurt.",
    severities: { leve: "Minor", grave: "Serious", muy_grave: "Very serious", mortal: "Fatal" },
    what: "What happened",
    whatHelp: "Describe what happened. Don't write medical data or diagnoses.",
    causes: "Causes",
    photos: "Photos",
    witnesses: "Witnesses",
  },
  lockedField: (label: string) =>
    `“${label}” is a fixed field of the accident form: you can change its text, but not remove it or change its type or options.`,
  incidents: {
    notFoundActions: "First mark every measure as done.",
    alreadyClosed: "The case is already closed.",
    notClosed: "The case isn't closed.",
    alreadyInvestigating: "The case is already under investigation.",
    actionDone: "That measure is already done.",
    tooMany: (max: string) =>
      `Too many to export (up to ${max}). Narrow them down with the filters.`,
    csv: {
      fileName: "accidents-and-incidents.csv",
      date: "Date",
      type: "Type",
      severity: "Severity",
      place: "Place",
      person: "Person affected",
      department: "Department",
      reportedBy: "Reported by",
      status: "Status",
      actions: "Measures done",
      open: "Open",
      investigating: "Under investigation",
      closed: "Closed",
    },
  },
  planning: {
    origins: {
      INCIDENT: "Accident or incident",
      RISK_ASSESSMENT: "Risk assessment",
      INSPECTION: "Inspection",
      DRILL: "Drill",
      COMMITTEE: "Committee",
      OTHER: "Other",
    },
    priorities: { LOW: "Low", MEDIUM: "Medium", HIGH: "High" },
    incidentOf: (day: string) => `Accident or incident on ${day}`,
    drillOf: (scenario: string, day: string) => `${scenario} drill on ${day}`,
    meetingOf: (kind: string, day: string) => `${kind} meeting on ${day}`,
    recordOf: (form: string, day: string) => `${form} on ${day}`,
    messages: {
      notRiskAssessment: "That document isn't a risk assessment (type EVR).",
      recordConforming: "That record has no non-conforming answers.",
    },
    csv: {
      fileName: "preventive-planning.csv",
      description: "Measure",
      origin: "Origin",
      reference: "Reference",
      priority: "Priority",
      cost: "Estimated cost",
      responsible: "Responsible",
      dueOn: "Due",
      status: "Status",
      doneOn: "Done on",
      open: "Pending",
      overdue: "Overdue",
      done: "Done",
    },
  },
  indicators: {
    messages: { notMonth: "The month has to be its first day (YYYY-MM-01)." },
    csv: {
      fileName: (year: number) => `accident-rates-${String(year)}.csv`,
      period: "Period",
      hours: "Hours worked",
      headcount: "Average headcount",
      accidents: "Accidents with leave",
      lostDays: "Days of leave",
      frequency: "Frequency rate",
      severity: "Severity rate",
      incidence: "Incidence rate",
      ytd: (year: number) => `${String(year)} to date`,
      last12: "Last 12 months",
    },
  },
  training: {
    alreadyCourse: "That document is already a course.",
    stillValid: "Your training for this course is still valid.",
    repeated: "The same person appears twice in the attendance.",
    notListed: "You're not on this training's list. Ask whoever gave it to add you.",
    sessionClosed: "This signing is closed: ask whoever gave the training to open another one.",
    alreadySigned: "You already signed this training.",
    noAttendees: "Choose at least one person for the signing.",
  },
  personPdf: {
    title: "Health and safety sheet",
    generated: (when: string, who: string) => `Generated on ${when} by ${who}.`,
    position: "Position",
    noPosition: "No position",
    departments: "Departments",
    health: "Contains health data: treat it as confidential and don't share it.",
    ppe: {
      title: "Personal protective equipment (PPE)",
      item: "Equipment",
      quantity: "Quantity",
      size: "Size",
      delivered: "Handed out",
      replaceOn: "Replace on",
      none: "No PPE handed out.",
      missing: "Missing for their position:",
      expired: "expired",
    },
    training: {
      title: "Training",
      course: "Course",
      state: "State",
      completed: "Done",
      validUntil: "Expires",
      none: "No courses assigned.",
    },
    states: {
      valid: "Valid",
      due_soon: "Due soon",
      expired: "Expired",
      pending: "Pending",
    },
    fitness: {
      title: "Fitness for work",
      status: "Result",
      validUntil: "Until",
      restrictions: "Restrictions",
      none: "No fitness assessments.",
      statuses: { APT: "Fit", APT_RESTRICTED: "Fit with restrictions", NOT_APT: "Not fit" },
    },
    incidents: {
      title: "Accidents and incidents",
      date: "Date",
      type: "Type",
      place: "Place",
      status: "State",
      none: "No accidents or incidents.",
    },
    fileName: (person: string, day: string) => `Health and safety sheet ${person} ${day}.pdf`,
  },
  attendancePdf: {
    title: "Training attendance record",
    person: "Attendee",
    signature: "Signature",
    recordedBy: (who: string) => `Recorded by ${who}.`,
    fileName: (course: string, day: string) => `Attendance ${course} ${day}.pdf`,
  },
  fitnessWhat: (person: string) => `${person}'s fitness for work`,
  examplePpe: [
    { name: "Cut-resistant gloves", category: "Hands", hasSizes: true, lifeMonths: 6 },
    { name: "Safety footwear", category: "Feet", hasSizes: true, lifeMonths: 12 },
    { name: "Cold room jacket", category: "Body", hasSizes: true, lifeMonths: 24 },
    { name: "Hearing protection", category: "Ears", hasSizes: false, lifeMonths: 1 },
    { name: "Safety glasses", category: "Eyes", hasSizes: false, lifeMonths: 12 },
    { name: "Chain mail apron", category: "Body", hasSizes: true, lifeMonths: 24 },
  ],
  inspectionForm: {
    name: "Monthly safety inspection",
    checks: "Checks",
    items: [
      "Emergency exits clear and signposted",
      "Fire extinguishers in place and checked",
      "First aid kit complete",
      "Machine guards in place",
      "Floors dry and clear",
      "Everyone wears their PPE",
    ],
    notes: "Notes",
    signature: "Inspector's signature",
  },
  ppe: { es: "PPE", latam: "PPE" },
  messages: {
    itemNameTaken: "There's already an item with that name in the catalog.",
    itemArchived: "That item is archived: it can't be handed out.",
    signatureInvalid: "The recipient's signature is missing, or it isn't a valid image.",
    alreadyVoided: "That handout is already voided.",
    sizeRequired: (item: string) => `The size of “${item}” is missing.`,
    repeatedItem: "The same item appears twice in the handout.",
  },
  expiryWhat: (item: string, person: string) => `${person}'s ${item}`,
  pdf: {
    title: (ppe: string) => `${ppe} handout receipt`,
    person: "Received by",
    position: "Position",
    deliveredBy: "Handed out by",
    date: "Date",
    columns: { item: "Item", quantity: "Quantity", size: "Size", replaceOn: "Replace on" },
    note: "Notes",
    signature: "Recipient's signature",
    statement:
      "I received the protective equipment listed, in good condition, and the information on how to use, keep and replace it. I agree to use it and to report if it's damaged or lost.",
    voided: (when: string, who: string, reason: string) => `Voided on ${when} by ${who}: ${reason}`,
    fileName: (person: string, day: string) => `Handout ${person} ${day}.pdf`,
    pageFooter: (page: string, total: string) => `Page ${page} of ${total}`,
  },
};

export const safetyIncidentEmailTexts: Catalog<typeof Es.safetyIncidentEmailTexts> = {
  greeting: (name: string) => `Hi ${name},`,
  subject: "A new accident or incident was reported",
  title: "There's a new case",
  body: (who: string) =>
    `${who} reported an accident or incident. As it's health data, the details are only in the app.`,
  action: "See the case",
  footnote: "You get this notice because you can see the company's health data.",
};

export const caeTexts: Catalog<typeof Es.caeTexts> = {
  folder: { es: "Contractors", latam: "Contractors" },
  catalog: {
    es: {
      liabilityInsurance: "Liability insurance and receipt",
      socialSecurityCert: "Certificate of being up to date with Social Security",
      taxCert: "Certificate of being up to date with the tax office",
      preventiveModality: "Health and safety organization model",
      riskAssessment: "Risk assessment of the work to be done",
      preventivePlanning: "Planning of the preventive activity",
      workerList: "List of workers (RNT/ITA)",
      prlTraining: "Health and safety training for the job",
      medicalFitness: "Medical fitness certificate",
      ppeHandout: "PPE handout",
      socialSecurityRegistration: "Social Security registration",
      siteRiskInfo: "Site risk information received",
    },
    latam: {
      liabilityInsurance: "Liability insurance",
      socialSecurityPayment: "Proof of social security payment",
      riskMatrix: "Risk matrix of the work",
      sstProgram: "Health and safety program",
      sstTraining: "Health and safety training",
      medicalFitness: "Medical fitness",
      ppeHandout: "PPE handout",
      socialSecurityAffiliation: "Social security affiliation",
      siteInduction: "Site safety induction",
    },
  },
  expiryWhat: (requirement: string, subject: string) => `${requirement} for ${subject}`,
  workerOf: (worker: string, company: string) => `${worker} (${company})`,
  pdf: {
    title: "Authorized today",
    generated: (when: string, who: string) => `Generated on ${when} by ${who}.`,
    company: "Company",
    date: "Day",
    companyStatus: "Company status",
    authorized: "Authorized",
    notAuthorized: "Not authorized",
    columns: {
      worker: "Worker",
      idNumber: "ID",
      task: "Job or task",
      status: "Can come in?",
      reasons: "Reasons",
    },
    yes: "Yes",
    no: "No",
    none: "It has no active workers.",
    fileName: (company: string, day: string) => `Authorized today ${company} ${day}.pdf`,
    pageFooter: (page: string, total: string) => `Page ${page} of ${total}`,
  },
  info: {
    pdf: {
      title: "Receipt of information handed to an external company",
      company: "Company",
      date: "Date handed over",
      receivedBy: "Received by",
      deliveredBy: "Handed over by",
      columns: { code: "Code", title: "Document", version: "Version" },
      statement:
        "I received the information about the site's risks, the prevention and emergency measures and the instructions listed, in their current versions, to pass it on to my company's workers (Royal Decree 171/2004, articles 7 to 9).",
      signature: "Signature of whoever receives it",
      noSignature: "Not signed on screen.",
      fileName: (company: string, day: string) => `Information handed over ${company} ${day}.pdf`,
      pageFooter: (page: string, total: string) => `Page ${page} of ${total}`,
    },
  },
  permits: {
    types: {
      HOT_WORK: "Hot work",
      HEIGHT: "Work at height",
      CONFINED_SPACE: "Confined spaces",
      ELECTRICAL: "Electrical work",
      OTHER: "Other",
    },
    statuses: {
      DRAFT: "Draft",
      ACTIVE: "Active",
      CLOSED: "Closed",
      CANCELLED: "Cancelled",
    },
    pdf: {
      title: "Work permit",
      type: "Type",
      status: "Status",
      company: "Company",
      ownCompany: "Own staff",
      location: "Location",
      description: "Work",
      validity: "Valid",
      from: "From",
      to: "To",
      people: "People authorized",
      precautions: "Precautions checked",
      done: "Yes",
      notDone: "No",
      issuedBy: "Issued by",
      approvedBy: "Approved by",
      signature: "Signature of whoever approves",
      closed: (when: string, who: string) => `Closed on ${when} by ${who}.`,
      cancelled: (when: string, who: string) => `Cancelled on ${when} by ${who}.`,
      note: "Notes",
      fileName: (type: string, day: string) => `Work permit ${type} ${day}.pdf`,
      pageFooter: (page: string, total: string) => `Page ${page} of ${total}`,
    },
  },
  foodCatalog: {
    es: {
      pestControl: "Pest control company's certificate (ROESB)",
      foodHandling: "Food handler training",
      hygieneRules: "Site hygiene and good manufacturing practice rules received",
    },
    latam: {
      pestControl: "Pest control company's health authorization",
      foodHandling: "Food handler training",
      hygieneRules: "Site hygiene and GMP rules received",
    },
  },
  portal: {
    invalid: "The link or the code isn't valid, or the access is no longer active.",
    noSession: "Your session ended: sign in again with the code.",
    fileType: "Upload a PDF or a photo (JPG or PNG).",
    fileTooLarge: (mb: number) => `The file is over ${String(mb)} MB.`,
    infoNotChosen: "That document isn't part of the site information.",
    uploadGone: "That upload is gone: upload the file again.",
  },
  messages: {
    companyNameTaken: "There's already a company with that name.",
    requirementNameTaken: "There's already a required document with that name.",
    parentRequired: "A subcontractor needs the contractor it works for.",
    parentInvalid: "The company it works for has to be an active contractor.",
    parentOnlySubcontractor: "Only a subcontractor works for another company.",
    hasSubcontractors: "This contractor has subcontractors: change or archive them first.",
    datesInverted: "The end date can't be before the start date.",
    responsibleInvalid: "The internal contact has to be an active person in the company.",
    archived: "It's archived: it can't be changed.",
    workerArchived: "It's archived: it can't be changed.",
    alreadyBlocked: "It's already blocked.",
    notBlocked: "It isn't blocked.",
    alreadyArchived: "It's already archived.",
    moduleOff: "Turn on the occupational health and safety module first.",
    nodeNotInFolder: "The file has to be in the company's folder (or in one inside it).",
    noFolder: "The company has no folder: check that the module's space exists.",
    requirementScope:
      "That document is asked of the company or of each worker: choose who it belongs to.",
    requirementNotApplicable: "That document isn't asked of this type of company.",
    requirementArchived: "That required document is archived.",
    workerNotInCompany: "That worker isn't from this company.",
    notPending: "That document has already been reviewed.",
    accessLogOff: "The entry and exit log isn't turned on.",
    deniedIn: "They aren't authorized: their entry can't be recorded.",
    infoNotDocument: "That document isn't a controlled document in force.",
    infoNotChosen: "That document isn't among the information for contractors.",
    infoNone: "First choose which controlled documents are the information for contractors.",
    permitNotDraft: "Only a draft permit can be changed.",
    permitNotActive: "That permit isn't active.",
    permitClosed: "That permit is already closed or cancelled.",
    permitDates: "The end has to be after the start.",
    permitTooLong: (days: number) =>
      `A permit lasts at most ${String(days)} days: for longer, issue another one.`,
    permitEnded: "That permit has already ended: issue another one.",
    permitNoPeople: "Add at least one person to the permit.",
    permitTooManyPeople: (max: number) => `A permit has at most ${String(max)} people.`,
    permitCustomName: "Write what kind of permit it is.",
    permitWorkerCompany: "The workers have to be from the permit's company.",
    permitWorkerNotAuthorized: (name: string) =>
      `${name} isn't authorized: they can't be on the permit.`,
    permitMemberInvalid: "Some of those people aren't active in the company.",
    permitPrecautionsPending: "Tick every precaution as checked before approving it.",
    orderMismatch: "The order has to include every required document of that kind, once.",
  },
  reasons: {
    missing: (requirement: string) => `Missing: ${requirement}`,
    expired: (day: string, requirement: string) => `Expired on ${day}: ${requirement}`,
    pending: (requirement: string) => `To review: ${requirement}`,
    rejected: (requirement: string) => `Rejected: ${requirement}`,
    companyBlocked: (reason: string) => `Company blocked: ${reason}`,
    companyArchived: "Company archived",
    notStarted: (day: string) => `Starts working on ${day}`,
    ended: (day: string) => `Stopped working on ${day}`,
    parentNotAuthorized: (name: string) => `Its contractor isn't authorized: ${name}`,
    companyNotAuthorized: (name: string) => `Its company isn't authorized: ${name}`,
    workerBlocked: (reason: string) => `Worker blocked: ${reason}`,
    infoMissing: (doc: string) => `The site information hasn't been handed over: ${doc}`,
    workerArchived: "Worker archived",
  },
};

export const expiryNoticeTexts: Catalog<typeof Es.expiryNoticeTexts> = {
  greeting: (name: string) => `Hi ${name},`,
  subject: {
    soon: (what: string) => `Expiring: ${what}`,
    expired: (what: string) => `Expired: ${what}`,
  },
  title: { soon: "Something is about to expire", expired: "Something expired" },
  body: (what: string, when: string) => `“${what}” ${when}.`,
  when: {
    inDays: (date: string, days: number) => `expires on ${date} (in ${String(days)} days)`,
    tomorrow: (date: string) => `expires tomorrow, ${date}`,
    today: "expires today",
    past: (date: string) => `expired on ${date}`,
  },
  action: "View",
  footnote:
    "You get this notice because this expiry is yours or you're the one to take care of it.",
};

export const formNoticeTexts: Catalog<typeof Es.formNoticeTexts> = {
  greeting: (name: string) => `Hello ${name},`,
  form_nonconforming: {
    subject: (what: string) => `Non-conforming: ${what}`,
    title: "A record has non-conforming answers",
    body: (who: string, what: string, fields: string) =>
      `${who} sent a record of \u201c${what}\u201d with answers outside what's expected: ${fields}.`,
    action: "See the record",
  },
  form_due: {
    subject: (what: string) => `To fill in: ${what}`,
    title: "There's a form to fill in",
    body: (what: string, period: string) =>
      `\u201c${what}\u201d is due (${period}). One record from any of the people assigned completes it.`,
    action: "Fill in the form",
  },
  form_overdue: {
    subject: (what: string) => `No record: ${what}`,
    title: "A form wasn't filled in",
    body: (what: string, period: string) => `Nobody filled in \u201c${what}\u201d ${period}.`,
    action: "Open the form",
  },
  periods: {
    day: (date: string) => `on ${date}`,
    week: (monday: string) => `the week of ${monday}`,
    month: (month: string) => `in ${month}`,
  },
  footnote: "You get this notice because you take part in this form or are in charge of it.",
};

export const formExportTexts: Catalog<typeof Es.formExportTexts> = {
  fileName: (form: string, extension: string) => `${form} - records.${extension}`,
  headers: [
    "Date",
    "Person",
    "Version",
    "Source",
    "Non-conforming",
    "Voided on",
    "Reason for voiding",
  ],
  sources: { app: "App", qr: "QR" },
  words: {
    yes: "Yes",
    no: "No",
    unchecked: (items: string) => `(unchecked: ${items})`,
    photos: (count: number) => (count === 1 ? "1 photo" : `${String(count)} photos`),
    signed: "Signed",
  },
  version: (version: number) => `Version ${String(version)}`,
  nonConforming: "Non-conforming",
  voided: (at: string, by: string, reason: string) => `Voided on ${at} by ${by}: ${reason}`,
  summary: (space: string, at: string, count: number) =>
    `${space} · Exported on ${at} · ${count === 1 ? "1 record" : `${String(count)} records`}`,
  empty: "No records with those filters.",
  tooMany: (max: string) =>
    `There are more than ${max} records. Narrow the dates down and export again.`,
  pageFooter: (page: string, total: string) => `Page ${page} of ${total}`,
};

export const expiryTexts: Catalog<typeof Es.expiryTexts> = {
  csv: {
    fileName: "expiries.csv",
    tooMany: "There are too many expiries to export. Filter the list and try again.",
    dueOn: "Due",
    element: "Item",
    space: "Space",
    state: "State",
    responsible: "Responsible",
    note: "Note",
    states: { valid: "Valid", due_soon: "Due soon", expired: "Expired" },
  },
};

export const auditRoomTexts: Catalog<typeof Es.auditRoomTexts> = {
  watermark: (email: string, when: string) => `Audit copy · ${email} · ${when}`,
  invite: {
    subject: (company: string) => `${company} shares an audit room with you`,
    title: "You have an audit room",
    body: (company: string, room: string, until: string) =>
      `${company} shared the room “${room}” with you, read-only, until ${until}.`,
    how: "When you open it, ask for the code: it comes to this email and works only once.",
    action: "Open the room",
    footnote:
      "If you weren't expecting this email, you can ignore it: nobody gets in without the code.",
  },
  code: {
    subject: (code: string) => `Your audit room code: ${code}`,
    title: "Your access code",
    body: (room: string) =>
      `This is your code to enter “${room}”. It works for 10 minutes and only once:`,
    footnote: "If you didn't ask for it, ignore this email: nobody gets in without the code.",
  },
  errors: {
    closed: "This room is no longer available: it expired or was revoked.",
    badCode: "The code isn't right or has expired. Ask for a new one.",
    tooManyTries: "Too many tries with this code. Ask for a new one.",
    noSession: "Your access to the room ended. Ask for the code again.",
    maxDays: "A room can last up to 30 days.",
    pastDate: "The expiry has to be a future date.",
    notShareable: "That item can't be shared in a room.",
    unsupported:
      "This type of file can't be shown in the room. Share a PDF, Word, Excel or an image.",
    noDownload: "This room doesn't allow downloads.",
    creatorGone: "Whoever created the room is no longer in the company: the room can't be opened.",
  },
  reports: {
    readings: (doc: string) => `Reading compliance · ${doc}`,
    approvals: (doc: string) => `Approvals and versions history · ${doc}`,
    formRecords: (form: string, from: string, to: string) =>
      `Records of “${form}” · ${from} to ${to}`,
    training: (course: string) => `Training records · ${course}`,
    ppe: (from: string, to: string) => `PPE handouts · ${from} to ${to}`,
    auditLog: (from: string, to: string) => `Audit log · ${from} to ${to}`,
    generated: (when: string) => `Generated on ${when}.`,
    columns: {
      person: "Person",
      status: "Status",
      readAt: "Read",
      version: "Version",
      state: "State",
      published: "Published",
      approvals: "Approvals",
      change: "Change",
      date: "Date",
      by: "By",
      record: "Record",
      values: "Answers",
      item: "Equipment",
      quantity: "Quantity",
      action: "Action",
      what: "On",
      completed: "Done",
      source: "How",
      until: "Expires",
    },
    readingStatus: { read: "Read", pending: "Pending", overdue: "Overdue", noAccess: "No access" },
    sources: { READING: "Reading", IN_PERSON: "In person" },
    decisions: {
      APPROVED: "Approved",
      CHANGES_REQUESTED: "Asked for changes",
      REJECTED: "Rejected",
    },
    empty: "No data in this period.",
    voided: "Voided",
  },
  notice: {
    firstAccess: "came in for the first time",
  },
};

export const qualityTexts: Catalog<typeof Es.qualityTexts> = {
  space: {
    name: "Quality",
    description: "Quality and food safety documents, records and evidence.",
  },
  ncFolder: "Nonconformities",
  code: (year: number, number: number) => `NC-${String(year)}-${String(number).padStart(4, "0")}`,
  origins: {
    INTERNAL: "Internal",
    CCP: "CCP or record out of limits",
    AUDIT_INTERNAL: "Internal audit",
    AUDIT_EXTERNAL: "External audit",
    COMPLAINT: "Complaint",
    SUPPLIER: "Supplier",
    OTHER: "Other",
  },
  severities: { MINOR: "Minor", MAJOR: "Major", CRITICAL: "Critical" },
  statuses: {
    OPEN: "Open",
    ANALYSIS: "Under analysis",
    ACTIONS: "With actions",
    VERIFICATION: "Under verification",
    CLOSED: "Closed",
    CANCELLED: "Cancelled",
  },
  kinds: { CORRECTION: "Correction", CORRECTIVE: "Corrective", PREVENTIVE: "Preventive" },
  fromRecord: (form: string) => `${form}: non-conforming record`,
  fromRecordDescription: (fields: string) => `Fields out of limits: ${fields}.`,
  verifyWhat: (code: string) => `Check the effectiveness of ${code}`,
  messages: {
    moduleOff: "The quality module isn't on.",
    closed: "The nonconformity is closed or cancelled.",
    notClosed: "Only a closed nonconformity can be reopened.",
    actionDone: "The action is already done.",
    tooManyActions: (max: number) => `A nonconformity can have up to ${String(max)} actions.`,
    actionsPending: "There are still actions to do.",
    noActions: "Add at least one action before checking.",
    notInVerification: "The nonconformity isn't under verification.",
    recordConforming: "The record has no non-conforming answers.",
    analysisInvalid: "The cause analysis isn't valid for the chosen method.",
    tooMany: (max: string) => `There are more than ${max} rows: narrow the filters.`,
  },
  csv: {
    fileName: "nonconformities.csv",
    code: "Code",
    title: "Title",
    origin: "Origin",
    severity: "Severity",
    status: "Status",
    detectedOn: "Detected on",
    owner: "Owner",
    department: "Department",
    actions: "Actions",
    actionsOpen: "Pending actions",
    rootCause: "Root cause",
    closedOn: "Closed on",
  },
};
