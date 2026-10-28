// App texts in English (plain US English, "you"). Same shape as the reference catalog (es/),
// checked by the `Messages` type in ../index.ts.

import type { Messages } from "../index";
import { adminTexts, capabilityGroupTexts, capabilityTexts } from "./admin";
import { auditEs } from "./audit";
import { bianEs } from "./bian";
import { licenseEs } from "./license";
import { accessAuditTexts } from "./access-audit";
import { documentsTexts } from "./documents";
import { qrTexts } from "./qr";
import { searchTexts } from "./search";
import { filesTexts } from "./files";
import { pagesTexts } from "./pages";
import { sharingTexts } from "./sharing";
import { profileTexts } from "./profile";
import { termsTexts } from "./terms";

export const en: Messages = {
  admin: adminTexts,
  capabilities: capabilityTexts,
  capabilityGroups: capabilityGroupTexts,
  audit: auditEs,
  bian: bianEs,
  license: licenseEs,
  files: filesTexts,
  sharing: sharingTexts,
  documents: documentsTexts,
  qr: qrTexts,
  search: searchTexts,
  accessAudit: accessAuditTexts,
  pages: pagesTexts,
  profile: profileTexts,
  terms: termsTexts,
  app: { name: "SpiderFolio", loading: "Loading SpiderFolio…" },
  kiosk: {
    switchUser: "Switch user",
    confirmed: "Reading confirmed. Signing you out…",
    idle: {
      title: "Are you still there?",
      text: "For security, we sign you out when the session isn’t in use.",
      countdown: "seconds until you’re signed out",
      keep: "Continue",
    },
    home: {
      greeting: (name: string) => (name === "" ? "Hi" : `Hi, ${name}`),
      subtitle: "Here you’ll see the documents you need to read.",
      empty: {
        title: "You don’t have any documents to read yet",
        text: "When there’s a document for you, it shows up here. When you’re done, tap Switch user.",
      },
    },
  },
  combobox: {
    loading: "Loading…",
    empty: "No results",
    more: "See more",
    error: "We couldn’t search",
    clear: (label: string) => `Clear filter: ${label}`,
    remove: (name: string) => `Remove ${name}`,
    search: "Search…",
    searchIn: (label: string) => `Search in ${label}`,
    add: "Add…",
    done: "Done",
  },
  common: {
    loadMore: "Load more",
    loadingMore: "Loading…",
    shownOf: (shown: number, total: number) => `Showing ${String(shown)} of ${String(total)}`,
    email: "Email",
    password: "Password",
    name: "Full name",
    company: "Company name",
    continue: "Continue",
    backToLogin: "Back to sign in",
    showPassword: "Show password",
    hidePassword: "Hide password",
    retry: "Try again",
    close: "Close",
    cancel: "Cancel",
    undo: "Undo",
    undone: "Action undone.",
    typeToConfirm: (text: string) => `Type “${text}” to confirm`,
    logout: "Sign out",
    theme: { label: "Theme", light: "Light", dark: "Dark", system: "System" },
    language: "Language",
  },
  errors: {
    generic: "An unexpected error occurred. Try again in a few minutes.",
    network: "We couldn’t connect to SpiderFolio. Check your connection.",
    rateLimited: "Too many attempts. Wait a few minutes and try again.",
    required: "Fill in this field.",
    email: "Enter a valid email.",
    passwordMin: "Use at least 10 characters.",
    passwordMax: "Use at most 200 characters.",
    nameLength: "Between 2 and 80 characters.",
  },
  auth: {
    benefits: {
      eyebrow: "Internal documentation",
      title: "Your company’s documentation, in order.",
      subtitle: "Folders, pages and controlled documents with permissions that make sense.",
      items: [
        "Department permissions you can understand at a glance",
        "Controlled documents with a single current version",
        "Read confirmation and an audit log ready to export",
      ],
    },
    login: {
      title: "Sign in",
      subtitle: "Access your company’s documentation.",
      submit: "Sign in",
      forgot: "Forgot your password?",
      noAccount: "Don’t have an account yet?",
      register: "Get started for free",
      invalid: "Incorrect email or password.",
      mfa: {
        title: "Two-step verification",
        subtitle: "Enter the 6-digit code shown in your authenticator app.",
        code: "Code",
        recoveryHint: "Don’t have your phone? Enter one of your recovery codes.",
        remember: "Remember this device for 30 days",
        submit: "Verify",
        back: "Back",
        invalid: "The code is incorrect or has already been used.",
      },
    },
    pin: {
      title: "Sign in with username and PIN",
      subtitle: "Enter your username and tap your 6-digit PIN.",
      workspaceSubtitle: "Enter your company code to sign in.",
      workspace: "Company code",
      workspacePlaceholder: "my-company",
      loginName: "Username",
      pin: "PIN",
      digits: (typed: number, total: number) => `${String(typed)} of ${String(total)} digits`,
      erase: "Delete",
      submit: "Sign in",
      invalid: "Incorrect username or PIN.",
      rateLimited: "Too many attempts. Wait a few minutes or ask your supervisor for help.",
    },
    register: {
      title: "Create your account",
      subtitle: "Create your company on this server and start organizing its documentation.",
      submit: "Create account",
      hasAccount: "Already have an account?",
      login: "Sign in",
      passwordHint: "At least 10 characters.",
    },
    verify: {
      title: "Confirm your email",
      verifying: "Confirming your email…",
      done: "Done, your email is confirmed.",
      invalid: "The link isn’t valid or has expired.",
      missing: "Open this page from the link we sent you by email.",
      goToApp: "Go to SpiderFolio",
      resend: "Send a new link",
      resent: "We sent you a new link. Check your email.",
      loginToResend: "Sign in to request a new link.",
    },
    forgot: {
      title: "Reset your password",
      subtitle: "We’ll send you a link to choose a new one.",
      submit: "Send link",
      sent: "If there’s an account with that email, we sent you a link. It expires in 1 hour.",
    },
    reset: {
      title: "Choose a new password",
      submit: "Save password",
      done: "Done. Sign in with your new password.",
      invalid: "The link isn’t valid or has expired.",
      requestNew: "Request a new link",
      newPassword: "New password",
    },
    unverifiedBanner: {
      text: "Confirm your email to invite your team and publish documents.",
      action: "Resend email",
      sent: "We sent you the confirmation email.",
    },
  },
  shell: {
    home: "Home",
    openMenu: "Open menu",
    collapse: "Collapse menu",
    expand: "Expand menu",
    search: "Search",
    admin: "Administration",
    adminBack: "Back to the app",
    company: {
      label: "Company",
      settings: "Company settings",
      switch: "Switch company",
    },
    account: { themeLight: "Light theme", themeDark: "Dark theme" },
    create: {
      label: "Create",
      page: "New page",
      upload: "Upload files",
      space: "New space",
      pickSpaceToUpload: "Open the space where you want to upload the files.",
    },
    favorites: "Favorites",
    favoritesAll: (total: number) => `See all (${String(total)})`,
    favoritesEmpty: "Star spaces with ★ to keep them here",
    recents: "Recent",
    help: "Help and guides",
    pendingReadings: (count: number) =>
      count === 1 ? "1 pending reading" : `${String(count)} pending readings`,
    pendingApprovals: (count: number) =>
      count === 1 ? "1 pending approval" : `${String(count)} pending approvals`,
    newShared: "There are new shared items",
    brand: "SpiderFolio",
    roles: { OWNER: "Owner", ADMIN: "Admin", MEMBER: "Member", GUEST: "Guest" },
    noWorkspaces: {
      title: "You don’t have access to any workspace",
      text: "Ask whoever manages your company to invite you, or create a new account.",
    },
    notFound: { title: "We couldn’t find this page", action: "Go home" },
    routeError: {
      title: "Something went wrong",
      text: "We couldn’t show this screen. Reload the page; if it still happens, contact support.",
      updatedTitle: "SpiderFolio was updated",
      updatedText: "There’s a new version of the app. Reload the page to keep working.",
      reload: "Reload",
    },
    logoutDialog: {
      title: "Sign out?",
      text: "You’ll be signed out of SpiderFolio on this device. To sign back in, you’ll need your email and password.",
      pending: "Signing out…",
    },
  },
  notifications: {
    title: "Notifications",
    label: "Notifications",
    labelUnread: (count: number) => `Notifications: ${String(count)} unread`,
    markAll: "Mark all as read",
    empty: "You don’t have any notifications.",
    loadError: "Couldn’t load notifications.",
    unreadMark: "Unread",
    shared: (who: string, what: string) => `${who} shared “${what}” with you`,
    sharedAnon: (what: string) => `“${what}” was shared with you`,
    expiring: (what: string, when: string) => `Your access to “${what}” ${when}`,
    expiringGranted: (who: string, what: string, when: string) =>
      who === "" ? `An access to “${what}” ${when}` : `${who}’s access to “${what}” ${when}`,
    noAccess: "You no longer have access to what was shared with you.",
    emailFallback:
      "Your company’s email server failed: emails were sent through SpiderFolio. Check Security › Email.",
    emailFailing: (reason: string) =>
      `Email isn’t working: check the SMTP settings. Reason: ${reason}`,
    smtpReasons: {
      AUTH: "the server rejected the user or the password.",
      SENDER_REJECTED:
        "the server rejected the sender or the recipient (MAIL_FROM must be the same mailbox as SMTP_USER).",
      CONNECTION: "couldn’t connect to the SMTP server (server, port or security).",
      TLS: "couldn’t set up the secure connection (certificate or TLS).",
      UNKNOWN: "the SMTP server returned an error while sending.",
    },
    readingRequired: (what: string) => `You need to read “${what}”`,
    readingReminder: (what: string) => `You still need to confirm you read “${what}”`,
    bianUsage: (percent: number) =>
      `Your company has used ${String(percent)}% of this month’s Bian queries.`,
    bianRequest: (who: string) =>
      who === "" ? "More Bian queries were requested." : `${who} is asking for more Bian queries.`,
    invitationByLeader: (who: string, email: string, departments: string) =>
      `${who === "" ? "A department head" : who} invited ${email === "" ? "someone" : email}${departments === "" ? "" : ` to ${departments}`}.`,
    readingOverdueLeader: (who: string, what: string) =>
      `${who} didn’t confirm reading “${what}” on time`,
    approvalPending: (what: string) => `Pending approval: “${what}”`,
    approvalApproved: (what: string) => `“${what}” was approved`,
    approvalRejected: (what: string) => `“${what}” was rejected`,
    approvalChanges: (who: string, what: string) =>
      who === "" ? `Changes requested on “${what}”` : `${who} requested changes on “${what}”`,
    expiresToday: "expires today",
    expiresTomorrow: "expires tomorrow",
    expiresInDays: (days: number) => `expires in ${String(days)} days`,
    sharedToast: (count: number) =>
      count === 1 ? "1 item was shared with you." : `${String(count)} items were shared with you.`,
    sharedToastAction: "View",
  },
  dashboard: {
    title: "Home",
    greeting: (firstName: string, workspace: string) =>
      `Hi, ${firstName}. Here’s what’s happening at ${workspace}${workspace.endsWith(".") ? "" : "."}`,
    sharedBanner: {
      text: (count: number) =>
        count === 1
          ? "1 item was shared with you."
          : `${String(count)} items were shared with you.`,
      action: "View shared items",
    },
    kpis: {
      publishedDocuments: "Current documents",
      inReview: "In review",
      drafts: "Drafts",
      readingCompliance: "Reading compliance",
      activePeople: "Active people (30 days)",
      storage: "Storage used",
    },
    kpiContext: {
      publishedDocuments: {
        empty: "Publish your first controlled document to get started.",
        some: "With their approved version in use.",
      },
      inReview: {
        empty: "Nothing is waiting for review.",
        some: "Waiting for the approver’s decision.",
      },
      drafts: {
        empty: "There are no open drafts.",
        some: "Not yet sent for review.",
      },
      readingCompliance: {
        empty: "Request readings to track who read each version.",
        some: "Of the readings you requested, already confirmed.",
      },
      activePeople: {
        empty: "No activity yet.",
        some: "With some activity in the last month.",
      },
      storage: {
        empty: "Upload your first files to a space.",
        unlimited: "No storage limit.",
      },
    },
    storageOf: (used: string, total: string) => `${used} of ${total}`,
    activity: {
      title: "Activity — last 30 days",
      emptyTitle: "No activity yet",
      empty: "When your team uploads, publishes and reads documents, you’ll see the activity here.",
      series: { uploads: "Uploads", publications: "Publications", reads: "Confirmed readings" },
    },
    pending: {
      title: "My to-dos",
      emptyTitle: "You’re all caught up",
      empty:
        "You don’t have pending approvals or readings. When one is assigned to you, it’ll show up here.",
      kinds: { approval: "Approval", reading: "Reading" },
      due: (date: string) => `Due ${date}`,
      overdue: "Overdue",
      read: "Read",
      review: "Review",
      viewAllReadings: (total: number) => `See all ${String(total)} readings`,
      viewAllApprovals: (total: number) => `See all ${String(total)} approvals`,
    },
    bian: {
      title: "Ask Bian",
      text: "Find the answer in the documents you can already see.",
      placeholder: "For example: how do I request time off?",
      submit: "Ask",
    },
    shared: {
      title: "Recently shared with me",
      emptyTitle: "Nothing new shared",
      empty: "What your team shares with you will show up here.",
      by: (name: string) => `from ${name}`,
      all: "See everything shared",
    },
    favorites: {
      title: "Favorites",
      emptyTitle: "No favorites",
      empty: "Star spaces with ★ to keep them close at hand.",
      all: "See all",
    },
    leader: {
      compliance: {
        title: "Reading compliance in your area",
        emptyTitle: "No readings requested",
        empty: "Request a reading of a document in your area to track who read it.",
        of: (read: number, total: number) => `${String(read)} of ${String(total)} read it`,
        noAccess: (count: number) =>
          count === 1
            ? "1 without access to the document"
            : `${String(count)} without access to the document`,
        overdue: (count: number) => `${String(count)} overdue`,
        remind: "Remind those pending",
        reminded: (sent: number) =>
          sent === 0
            ? "They were already reminded today."
            : sent === 1
              ? "1 person was reminded."
              : `${String(sent)} people were reminded.`,
        allRead: "Everyone has read it",
      },
      reviewDue: {
        title: "Upcoming reviews (60 days)",
        emptyTitle: "Nothing to review",
        empty: "No documents in your area are due for review soon.",
        on: (date: string) => `Review before ${date}`,
      },
      inReview: {
        title: "Waiting for approval",
        emptyTitle: "Nothing in review",
        empty: "Documents from your area sent for review will show up here.",
        since: (when: string) => `Sent ${when}`,
      },
    },
    top: {
      title: "Most viewed this month",
      emptyTitle: "No views this month",
      empty: "The documents your team opens most will show up here.",
      people: (count: number) =>
        count === 1 ? "opened by 1 person" : `opened by ${String(count)} people`,
    },
    verifyAction: "Confirm my email",
    error: {
      title: "We couldn’t load the home page",
    },
  },
};
