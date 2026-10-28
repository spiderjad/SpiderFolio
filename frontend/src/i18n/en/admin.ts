// Admin panel texts (CLAUDE.md, section 9.3), in English.
import type { Catalog } from "../index";
import type {
  adminTexts as EsAdmin,
  capabilityGroupTexts as EsCapabilityGroups,
  capabilityTexts as EsCapabilities,
} from "../es/admin";

export const capabilityTexts: Catalog<typeof EsCapabilities> = {
  "members.view": {
    label: "View members",
    description: "Sees the list of members, their roles and their departments.",
  },
  "members.invite": {
    label: "Invite people",
    description: "Invites people to the workspace, and resends and revokes invitations.",
  },
  "members.manage": {
    label: "Manage members",
    description:
      "Changes members' role, seat, job title and departments, and removes them.",
  },
  "members.suspend": {
    label: "Suspend members",
    description: "Suspends and reactivates members, and signs them out.",
  },
  "members.pin": {
    label: "Manage PIN sign-in",
    description:
      "Creates people who sign in with a username and PIN, resets their PIN and sets up sign-in from shared tablets.",
  },
  "departments.manage": {
    label: "Manage departments",
    description:
      "Creates, edits, moves and deletes departments, and manages who belongs to each one.",
  },
  "departments.members.own": {
    label: "Manage people in their departments",
    description:
      "Own scope: adds, removes and moves people, but only in the departments they lead. If they stop being head, they lose it right away.",
  },
  "roles.manage": {
    label: "Manage roles",
    description: "Creates and edits custom roles. Can only grant capabilities they already have.",
  },
  "spaces.create": { label: "Create spaces", description: "Creates new spaces." },
  "spaces.manage": {
    label: "Manage spaces",
    description: "Edits and archives spaces, and sets who can access them.",
  },
  "content.bypass": {
    label: "Access to all content",
    description: "Sees content even without permission. Use with care.",
  },
  "permissions.audit": {
    label: "Audit permissions",
    description: "Checks who can see what and the access reports.",
  },
  "files.manage_trash": {
    label: "Manage the trash",
    description: "Restores or permanently deletes what's in the trash.",
  },
  "storage.view": {
    label: "View storage",
    description: "Checks storage usage and the largest files.",
  },
  "documents.approve": {
    label: "Approve documents",
    description: "Approves or rejects versions of controlled documents.",
  },
  "documents.approve.own": {
    label: "Approve documents from their departments",
    description:
      "Own scope: approves or rejects versions, but only from the departments they lead. Turns on with controlled documents.",
  },
  "documents.require_reading": {
    label: "Request reads",
    description: "Asks people or departments to read and confirm a version.",
  },
  "content.public_qr": {
    label: "Public QR codes",
    description: "Creates QR codes that open the current version without signing in.",
  },
  "audit.share": {
    label: "Share audits",
    description: "Sets up audit rooms for external auditors.",
  },
  "expirations.manage": {
    label: "Manage expiry dates",
    description: "Sets and reviews document expiry dates.",
  },
  "audit.view": {
    label: "View the audit log",
    description: "Checks who did what and when.",
  },
  "audit.export": {
    label: "Export the audit log",
    description: "Downloads the audit log with the applied filters.",
  },
  "security.manage": {
    label: "Manage security",
    description: "Changes the workspace security policies.",
  },
  "workspace.settings": {
    label: "Company settings",
    description: "Changes the workspace name, logo and color, and sets its limits.",
  },
};

export const capabilityGroupTexts: Catalog<typeof EsCapabilityGroups> = {
  members: "Members",
  organization: "Organization",
  content: "Content",
  documents: "Controlled documents",
  audit: "Audit log",
  administration: "Administration",
  plugins: "Plugins",
};

export const adminTexts: Catalog<typeof EsAdmin> = {
  nav: {
    group: "Management",
    members: "Members",
    departments: "Departments",
    roles: "Roles and permissions",
    access: "Access",
    security: "Security",
    bian: "Bian",
    license: "License and plugins",
    limits: "Limits and usage",
    audit: "Audit log",
  },
  security: {
    language: {
      title: "Company language",
      text: "Used by everyone who hasn't chosen one in My profile, and for invitations and controlled document PDFs.",
      label: "Default language",
    },
    title: "Security",
    subtitle: "Access and privacy rules for your workspace.",
    visibility: {
      title: "People visibility",
      text: "Sets who members see in the people directory (mentions and sharing). The owner and admins always see the whole company.",
      label: "Members see",
      hint: "Readers and guests don't see the directory.",
      company: "The whole company",
      department: "Only their department",
    },
    documents: {
      title: "Controlled documents",
      text: "How controlled documents are approved.",
      selfApproval: "Allow self-approval",
      selfApprovalHint:
        "Off: whoever submits a document for review can't approve it. If you turn it on, each self-approval is recorded in the audit log and the history as “approved by the author”.",
    },
    leaders: {
      title: "Heads and deputies",
      text: "What department leaders can do within their area and sub-areas.",
      invite: "Heads can invite to their area",
      inviteHint:
        "Only as a member or reader and only to their departments. Each invitation notifies the admins and shows up in Pending invitations.",
    },
    ownerOnly: "Only the owner can manage security.",
    bian: {
      title: "Bian assistant",
      text: "Bian answers questions using the documents each person can already see, always citing its sources. It never sees what the person can't see.",
      enabled: "Turn on Bian for your company",
      enabledHint:
        "If you turn it off, nobody can ask it anything and new content stops being indexed.",
      guests: "Allow guests",
      guestsHint:
        "External guests only see what was shared with them, and Bian only uses that. Off by default.",
    },
    tabs: { label: "Security sections", general: "General", email: "Email" },
    email: {
      system: {
        title: "Server email",
        text: "This installation's SMTP server (SMTP_HOST in .env): it sends verifications, passwords, sign-ins and, if your company has no custom sender, every notice.",
        server: (host: string, port: number) => `Server: ${host}:${String(port)}`,
        from: (from: string) => `Sender: ${from}`,
        ok: "Working",
        failing: "Not working",
        unknown: "No emails sent yet",
        failingSince: (when: string) => `Last failed: ${when}`,
        lastSuccess: (when: string) => `Last successful send: ${when}`,
        failingHelp: "Check SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS and MAIL_FROM in the server's .env and restart with \"docker compose up -d --force-recreate app worker\".",
        test: "Send test email",
        testHint: "It goes to your own email.",
        testOk: "Test sent. Check your inbox (and the spam folder).",
        testFailed: "The test failed",
        detail: {
          reason: "Reason",
          code: "Code",
          response: "Server reply",
        },
      },
      title: "Custom email sender",
      text: "Your company's emails (invitations, document notices, shares) are sent from your own SMTP server. Account emails (email verification, password, sign-in) are always sent by SpiderFolio.",
      unavailable: "The custom sender isn't available on this server.",
      status: {
        DRAFT: "Not active",
        ACTIVE: "Active",
        DISABLED: "Disabled",
      },
      tested: "Tested",
      notTested: "Not tested",
      lastError: (error: string) => `Last error: ${error}`,
      fallbackNotice:
        "Some emails were sent through SpiderFolio because your server failed. Check the settings and test them again.",
      disabledNotice:
        "We disabled the custom sender after several failures in a row. Fix the settings, send a test and turn it on again.",
      fields: {
        fromName: "Sender name",
        fromEmail: "Sender address",
        fromEmailHint: "It must be an address your SMTP server lets you use.",
        replyTo: "Reply-to (optional)",
        smtpHost: "SMTP server",
        smtpPort: "Port",
        smtpSecurity: "Security",
        smtpUser: "Username (optional)",
        smtpPass: "Password",
        smtpPassHint:
          "It's stored encrypted and never shown again. Leave it empty to keep the current one.",
        smtpPassSaved: "Saved",
      },
      security: { STARTTLS: "STARTTLS (port 587)", TLS: "TLS (port 465)" },
      actions: {
        save: "Save",
        saving: "Saving…",
        test: "Send test email",
        testing: "Sending…",
        activate: "Turn on",
        deactivate: "Turn off",
      },
      testHint: "The test goes to your own email. It has to pass before you can turn it on.",
      saved: "Settings saved. Send a test so you can turn it on.",
      testOk: "Test sent. Check your inbox and turn on the sender.",
      activated: "Custom sender turned on.",
      deactivated: "Custom sender turned off.",
      domain: {
        title: "Verified domain",
        text: "Instead of your own SMTP server, SpiderFolio sends from an address on your domain. You create a few DNS records, we verify them and you're done: no password needed.",
        soon: "Sending with a verified domain will be available soon.",
        domain: "Domain",
        domainHint:
          "For example, company.com. It's the domain of the addresses you want to send from.",
        fromName: "Sender name",
        localPart: "Address (before the @)",
        localPartHint: "For example, notices.",
        replyTo: "Reply-to (optional)",
        register: "Get DNS records",
        registering: "Registering…",
        update: "Save sender",
        recordsTitle: "Create these records in your domain's DNS",
        recordsHint:
          "DNS changes can take a few hours to propagate. Once you've created them, click “Verify now”.",
        columns: { type: "Type", name: "Name", value: "Value", status: "Status" },
        verified: "Verified",
        pending: "Pending",
        verify: "Verify now",
        verifying: "Verifying…",
        remove: "Remove domain",
        registered: "Domain registered. Create the DNS records and verify them.",
        allVerified: "Domain verified. Send a test and turn on the sender.",
        stillPending: "Some records aren't verified yet.",
        removed: "Domain removed.",
        mode: { SMTP: "Active mode: own SMTP", DOMAIN: "Active mode: verified domain" },
      },
      guide: {
        title: "Are your emails going to spam?",
        intro:
          "To keep emails from your domain out of spam, set up these DNS records on your domain. Your email provider gives you the exact values.",
        spf: {
          title: "SPF",
          text: "A TXT record on your domain that says which servers can send on your behalf. There can only be one: if you already have one, add your provider's include.",
          example: "v=spf1 include:spf.your-provider.com ~all",
        },
        dkim: {
          title: "DKIM",
          text: "Your provider generates a key and gives you a TXT or CNAME record (for example, selector._domainkey.yourdomain.com). Create it exactly as they tell you.",
          example: "selector._domainkey.yourdomain.com  CNAME  selector.dkim.your-provider.com",
        },
        dmarc: {
          title: "DMARC",
          text: "A TXT record on _dmarc.yourdomain.com. Start with p=none (monitor only) and, once everything is delivered fine, move to quarantine.",
          example: "v=DMARC1; p=none; rua=mailto:dmarc@yourdomain.com",
        },
        test: {
          title: "How to check it",
          text: "Send the test email to your inbox and make sure it's not in spam. If it lands in spam, check that SPF and DKIM are set up correctly (DNS changes can take a few hours) and that the sender address is on your domain.",
        },
        copy: "Copy",
        copied: "Copied",
      },
    },
  },
  common: {
    search: "Search",
    all: "All",
    save: "Save",
    saving: "Saving…",
    create: "Create",
    creating: "Creating…",
    edit: "Edit",
    remove: "Remove",
    delete: "Delete",
    cancel: "Cancel",
    close: "Close",
    actions: "Actions",
    results: (count: number) => (count === 1 ? "1 result" : `${String(count)} results`),
    loadError: "We couldn't load the data",
    loadErrorText: "Check your connection and try again.",
    loadErrorServer: "Something went wrong on the server. Try again.",
    saved: "Changes saved.",
    never: "Never",
    none: "Unassigned",
  },
  limit: {
    title: "A company limit was reached",
    used: (used: number, max: number) => `You're using ${String(used)} of ${String(max)}.`,
    help: "Your company sets the limits. Anyone with “Company settings” can change them in Admin › Limits and usage.",
    close: "Got it",
    limits: {
      storageGb: "storage",
      maxFileMb: "maximum file size",
      fileVersionsKept: "versions kept per file",
      auditRetentionDays: "audit log days",
      aiQueriesPerMonth: "Bian questions per month",
    },
  },
  seats: {
    title: "Seats",
    full: "Full users",
    reader: "Readers",
    of: (used: number, max: number | null) =>
      max === null ? `${String(used)} (no limit)` : `${String(used)} of ${String(max)}`,
    hint: "Pending invitations also take up a seat.",
  },
  pin: {
    createButton: "Create person with PIN",
    locked: "PIN locked",
    resetAction: "Reset PIN",
    create: {
      title: "Create person with PIN",
      description:
        "For people without email: they sign in from a tablet with a username and a 6-digit PIN. They have a reader seat.",
      name: "Full name",
      loginName: "Username",
      loginNameHint: "3 to 32 lowercase letters, numbers, periods, hyphens or underscores.",
      role: "Role",
      roleHint: "Only member roles without admin capabilities.",
      departments: "Departments",
      pin: "PIN (optional)",
      pinHint: "If you leave it empty, we generate a random one and show it to you only once.",
      pinPlaceholder: "6 digits",
      submit: "Create",
      submitting: "Creating…",
    },
    reset: {
      title: "Reset the PIN?",
      text: (name: string) =>
        `${name} will get a new PIN and their open sessions will be closed. If they were locked out, they'll be unlocked. You'll only see the PIN once.`,
      action: "Reset",
      pending: "Resetting…",
    },
    reveal: {
      title: (name: string) => `Sign-in for ${name}`,
      description: "Give them these details in person. They sign in from the shop-floor tablet.",
      loginName: "Username",
      pin: "PIN",
      copy: "Copy PIN",
      copied: "PIN copied.",
      copyFailed: "Couldn't copy.",
      once: "This PIN is shown only once: you can't look it up later. If it's lost, reset it.",
      done: "Done",
    },
    settings: {
      title: "Sign-in with username and PIN",
      subtitle: "For shop-floor readers who share a tablet.",
      enabled: "Allow sign-in with username and PIN",
      enabledHint: "While this is off, nobody can sign in with a PIN.",
      idle: "Sign out after inactivity",
      idleHint: "Warns 30 seconds before signing out.",
      minutes: (count: number) => (count === 1 ? "1 minute" : `${String(count)} minutes`),
      closeAfterConfirm: "Sign out after confirming a read",
      address: "Address for tablets",
      copy: "Copy",
      copied: "Address copied.",
    },
  },
  members: {
    title: "Members",
    subtitle: "Who's in the workspace, with what role and in which departments.",
    teamTitle: "My team",
    teamSubtitle: "People in the departments you lead and their sub-areas.",
    roleOf: (name: string) => `${name}'s role`,
    invite: "Invite people",
    importCsv: "Import CSV",
    exportCsv: "Export CSV",
    exportDone: (rows: number) => `Exported ${String(rows)} people.`,
    searchPlaceholder: "Search by name, email or job title",
    filters: {
      role: "Role",
      department: "Department",
      status: "Status",
      managers: "Department heads",
    },
    noEmail: "Signs in with username and PIN",
    views: {
      list: "List",
      orgChart: "Org chart",
      label: "View",
    },
    legend: {
      title: "What can each one do?",
      items: [
        ["Owner and Admin", "the whole company."],
        ["Head and Deputy", "their department and its sub-areas."],
        ["Member", "uses what they were given."],
        ["Reader", "reads and confirms reads."],
      ],
      note: "Role and position are different things: an admin can also be a department head.",
    },
    summary: {
      label: "Summary by hierarchy",
      all: "All",
      owner: "Owner",
      admins: "Admins",
      managers: "Department heads",
      members: "Members",
      readers: "Readers",
      filterBy: (name: string) => `Filter by ${name.toLowerCase()}`,
    },
    roleBadge: {
      owner: "Owner",
      admin: "Admin",
      member: "Member",
      reader: "Reader",
      guest: "Guest",
    },
    position: {
      head: (department: string) => `Head of ${department}`,
      deputy: (department: string) => `Deputy of ${department}`,
      headShort: "Head",
      deputyShort: "Deputy",
    },
    leadership: {
      title: "Leadership",
      of: (departments: string) => `Head or deputy of ${departments}`,
      scopeNote:
        "Their position applies to their department and its sub-areas: if they stop holding it, they lose it right away.",
    },
    people: (count: number) => (count === 1 ? "1 person" : `${String(count)} people`),
    peopleAndAreas: (people: number, areas: number) =>
      `${people === 1 ? "1 person" : `${String(people)} people`}${
        areas === 0 ? "" : ` · ${areas === 1 ? "1 sub-area" : `${String(areas)} sub-areas`}`
      }`,
    byDepartment: {
      seeMore: (remaining: number) => `See more (${String(remaining)})`,
      loadingMore: "Loading…",
      noHead: "No head",
      noDepartments: "No departments match.",
      noDepartmentsAtAll: "There are no departments yet. Create the first one from Departments.",
      unassigned: "No department",
      unassignedHint: "People who don't belong to any department yet.",
      emptyBlock: "Nobody in this department yet.",
      assignHead: "Assign head",
      changeHead: "Change head",
      addDeputy: "Add deputy",
      makeHead: "Make head",
      makeDeputy: "Make deputy",
      removePosition: "Remove position",
      confirmRemovePosition: {
        title: (name: string, position: "HEAD" | "DEPUTY", department: string) =>
          `Remove ${name} as ${position === "HEAD" ? "head" : "deputy"} of ${department}?`,
        text: (position: "HEAD" | "DEPUTY") =>
          position === "HEAD"
            ? "They'll stay in the department, but will no longer manage it or approve its documents."
            : "They'll stay in the department, but will no longer stand in for the head.",
        action: (position: "HEAD" | "DEPUTY") =>
          position === "HEAD" ? "Remove as head" : "Remove as deputy",
        pending: "Removing…",
      },
      move: "Move to another department",
      searchPlaceholder: "Search for a department",
      assign: {
        readerWarning: (name: string) =>
          `${name} is a reader: the head position needs a full seat.`,
        needsFullSeat: (name: string) =>
          `${name} is a reader: they need a full seat to act as head.`,
        titleHead: (department: string) => `Head of ${department}`,
        titleDeputy: (department: string) => `Deputy of ${department}`,
        person: "Person",
        description: "Choose a person from the department.",
        search: "Search the department",
        none: "No people match.",
        submit: "Assign",
        pending: "Assigning…",
        doneHead: (name: string) => `${name} is now head of the department.`,
        doneDeputy: (name: string) => `${name} is now deputy of the department.`,
        removed: "Position removed.",
      },
      moveDialog: {
        title: (name: string) => `Move ${name}`,
        description: (from: string) =>
          `They'll leave ${from} (and lose their position there) and join the department you choose.`,
        to: "Destination department",
        toPlaceholder: "Search for a department",
        submit: "Move",
        pending: "Moving…",
        done: (name: string, to: string) => `${name} is now in ${to}.`,
      },
    },
    structureReview: {
      title: "Structure review",
      allGood: "The structure is set up correctly",
      toFix: (count: number) => (count === 1 ? "1 to review" : `${String(count)} to review`),
      info: "For your information",
      more: (count: number) => `and ${String(count)} more`,
      groups: {
        departmentsWithoutHead: {
          title: (n: number) =>
            n === 1 ? "1 department without a head" : `${String(n)} departments without a head`,
          hint: "Without a head, nobody approves or manages the team.",
          action: "Open the department and appoint a head.",
        },
        peopleWithoutDepartment: {
          title: (n: number) =>
            n === 1 ? "1 person without a department" : `${String(n)} people without a department`,
          hint: "They don't see what's shared with a department.",
          action: "Open the person's profile and assign them a department.",
        },
        readerLeaders: {
          title: (n: number) =>
            n === 1 ? "1 head with a reader seat" : `${String(n)} heads with a reader seat`,
          hint: "With a reader seat, the head position doesn't give them scope over their area.",
          action: "Switch them to a full seat from their profile.",
        },
        emptyDepartments: {
          title: (n: number) =>
            n === 1 ? "1 department with no people" : `${String(n)} departments with no people`,
          hint: "An empty department doesn't give anyone access.",
          action: "Add people to the department or delete it.",
        },
        adminLeaders: {
          title: (n: number) =>
            n === 1 ? "1 admin who is also a head" : `${String(n)} admins who are also heads`,
          hint: "As admins they already manage the whole company; the position only organizes the org chart.",
          action: "Nothing needs fixing.",
        },
      },
    },
    orgChart: {
      root: (company: string) => company,
      owner: (name: string) => `Owner: ${name}`,
      noOwner: "No owner",
      seesAllAdmin: "As an admin you see the whole company. Members only see their department.",
      seesAllLeader: "As a head you see the whole company. Members only see their department.",
      noHead: "No head",
      currentPath: "Current path",
      expandAll: "Expand all",
      collapseAll: "Collapse all",
      searchPlaceholder: "Search for a person in the org chart",
      searchNone: "No people match.",
      searchHint: "Type at least 2 letters.",
      open: (name: string) => `Open ${name}`,
      close: (name: string) => `Close ${name}`,
      filteredBy: (name: string) => `Showing only “${name}”`,
      clearFilter: "Clear filter",
      empty: "This branch has nothing yet.",
      branchLabel: "Company org chart",
      moreAreas: (remaining: number) => `See more areas (${String(remaining)})`,
    },
    status: { ACTIVE: "Active", SUSPENDED: "Suspended" },
    seat: { FULL: "Full", READER: "Reader" },
    columns: {
      name: "Name",
      role: "Role",
      departments: "Departments",
      seat: "Seat",
      status: "Status",
      lastSeen: "Last seen",
      twoFactor: "2FA",
    },
    twoFactor: { on: "On", off: "—", onLabel: "Two-step verification on" },
    you: "You",
    empty: {
      title: "Nobody else here yet",
      text: "Invite your team to start sharing documentation.",
    },
    noResults: { title: "No results", text: "Try another search or remove a filter." },
    selected: (count: number) => (count === 1 ? "1 selected" : `${String(count)} selected`),
    selectAll: "Select all",
    selectRow: (name: string) => `Select ${name}`,
    rowActions: (name: string) => `Actions for ${name}`,
    actions: {
      edit: "Edit",
      suspend: "Suspend",
      reactivate: "Reactivate",
      revokeSessions: "Sign out their sessions",
      resetTwoFactor: "Reset two-step verification",
      resetTwoFactorNeedsOwn: "Turn on your own two-step verification to reset someone else's.",
      remove: "Remove from workspace",
    },
    bulk: {
      changeRole: "Change role",
      changeDepartments: "Departments",
      changeSeat: "Change seat",
      suspend: "Suspend",
      reactivate: "Reactivate",
      confirmSuspend: {
        title: (count: number) =>
          count === 1 ? "Suspend 1 person?" : `Suspend ${String(count)} people?`,
        text: "They'll lose access to the workspace right away and stop taking up a seat. You can reactivate them anytime.",
        word: "suspend",
        action: (count: number) =>
          count === 1 ? "Suspend 1 person" : `Suspend ${String(count)} people`,
        pending: "Suspending…",
      },
      result: (ok: number, failed: number) =>
        failed === 0
          ? `Done: ${String(ok)} updated.`
          : `${String(ok)} updated and ${String(failed)} couldn't be changed.`,
      departmentMode: {
        add: "Add to departments",
        remove: "Remove from departments",
        set: "Replace departments",
      },
      apply: "Apply",
    },
    edit: {
      title: (name: string) => `Edit ${name}`,
      canSee: "What they can see",
      role: "Role",
      rolePlaceholder: "Search for a role",
      departmentsPlaceholder: "Search and add departments",
      seat: "Seat",
      seatAutoHint:
        "Based on the role: a full seat if it has admin capabilities; reader if it's an external guest.",
      seatHint:
        "A role with admin capabilities uses a full seat; an external guest, a reader seat.",
      departments: "Departments",
      noDepartments: "There are no departments yet.",
      guestDepartments: "An external guest can't join departments.",
      jobTitle: "Job title",
      jobTitlePlaceholder: "E.g. Quality manager",
      name: "Full name",
      email: "Email",
      emailHint:
        "If you change it, the person has to confirm the new email and their sessions are closed.",
      emailLockedHint: "They already confirmed their email: they change it from their account.",
    },
    confirm: {
      suspend: {
        title: (name: string) => `Suspend ${name}?`,
        text: (name: string) =>
          `${name} will lose access to this workspace right away and stop taking up a seat. You can reactivate them anytime.`,
        action: "Suspend",
        pending: "Suspending…",
      },
      reactivate: {
        title: (name: string) => `Reactivate ${name}?`,
        text: (name: string) => `${name} will be able to sign in again and will take up a seat.`,
        action: "Reactivate",
        pending: "Reactivating…",
      },
      resetTwoFactor: {
        title: (name: string) => `Reset two-step verification for ${name}?`,
        text: (name: string) =>
          `Their linked app, recovery codes and trusted devices will be deleted, and their sessions will be closed. ${name} will get an email notice and set it up again at next sign-in.`,
        action: "Reset",
        pending: "Resetting…",
      },
      revokeSessions: {
        title: (name: string) => `Sign out all of ${name}'s sessions?`,
        text: (name: string) =>
          `All of ${name}'s sessions will be closed, including in other workspaces on their account. They'll have to sign in again.`,
        action: "Sign out sessions",
        pending: "Signing out…",
      },
      remove: {
        title: (name: string) => `Remove ${name} from the workspace?`,
        text: (name: string) =>
          `${name} will no longer belong to this workspace and will lose all access. Their account isn't deleted, but to come back they'll need a new invitation.`,
        action: "Remove from workspace",
        pending: "Removing…",
      },
    },
    toasts: {
      twoFactorReset: "Two-step verification reset. We let them know by email.",
      updated: "Changes saved.",
      suspended: "Person suspended.",
      reactivated: "Person reactivated.",
      removed: "Person removed from the workspace.",
      sessionsRevoked: (count: number) =>
        count === 1 ? "1 session closed." : `${String(count)} sessions closed.`,
    },
  },
  invitations: {
    title: "Pending invitations",
    empty: "No pending invitations.",
    columns: { email: "Email", role: "Role", seat: "Seat", expires: "Expires", by: "Invited by" },
    searchPlaceholder: "Search by email",
    statusFilter: "Status",
    statuses: { all: "All", pending: "Active", expired: "Expired" },
    noResults: "No invitations match.",
    expired: "Expired",
    resend: "Resend",
    revoke: "Revoke",
    resent: "Invitation resent.",
    revoked: "Invitation revoked.",
    confirmRevoke: {
      title: (email: string) => `Revoke the invitation to ${email}?`,
      text: (email: string) =>
        `The link we sent to ${email} will stop working. You can invite them again anytime.`,
      action: "Revoke invitation",
      pending: "Revoking…",
    },
    dialog: {
      title: "Invite people",
      description: "We'll send them an email with a link to join. It expires in 7 days.",
      emails: "Emails",
      emailsHint: "One per line, or separated by commas or spaces. Up to 50.",
      role: "Role",
      seatAutoHint:
        "Automatic: full seat for members and admins, reader for external guests",
      seat: "Seat",
      seatAuto: "Automatic",
      departments: "Departments",
      submit: "Send invitations",
      submitting: "Sending…",
      noEmails: "Enter at least one valid email.",
      invalidEmails: (emails: string[]) =>
        `These don't look like valid emails: ${emails.join(", ")}.`,
      sent: (count: number) =>
        count === 1 ? "Invitation sent." : `${String(count)} invitations sent.`,
      skipped: (count: number) =>
        count === 1
          ? "1 person was skipped because they're already a member or have a pending invitation."
          : `${String(count)} people were skipped because they're already members or have a pending invitation.`,
      domainNotAllowed: "These emails aren't from an allowed domain.",
      verifyFirst: "Confirm your email to be able to invite.",
    },
  },
  importCsv: {
    title: "Import members from CSV",
    description:
      "Upload a file with one row per person. Columns: email (required), role, departments (separated by |) and seat (FULL or READER).",
    file: "CSV file",
    tooLarge: "The file is too large (maximum 200 KB).",
    paste: "Or paste the content",
    preview: "Preview",
    previewing: "Checking…",
    confirm: "Invite valid rows",
    confirming: "Inviting…",
    summary: (ok: number, skip: number, error: number) =>
      `${String(ok)} ready to invite · ${String(skip)} skipped · ${String(error)} with errors`,
    done: (invited: number) =>
      invited === 1 ? "1 invitation sent." : `${String(invited)} invitations sent.`,
    columns: { line: "Row", email: "Email", role: "Role", result: "Result" },
    status: { ok: "Ready", skip: "Skipped", error: "Error" },
    reasons: {
      invalid_email: "Invalid email",
      duplicate_in_file: "Duplicate in the file",
      unknown_role: "The role doesn't exist",
      role_not_allowed: "You can't invite with that role",
      unknown_department: "The department doesn't exist",
      guest_departments: "An external guest can't join departments",
      invalid_seat: "Invalid seat for that role",
      domain_not_allowed: "Domain not allowed",
      already_member: "Already a member",
      already_invited: "Already has a pending invitation",
    },
  },
  departments: {
    title: "Departments",
    subtitle:
      "Your company's areas. Access to content is given to departments, not person by person.",
    create: "New department",
    columns: {
      name: "Department",
      head: "Head",
      deputies: "Deputy(ies)",
      members: "People",
    },
    filters: { parent: "Inside", allParents: "All levels", root: "Top level" },
    searchPlaceholder: "Search for a department",
    noResults: { title: "No results", text: "Try another search or remove the filter." },
    members: (count: number) => (count === 1 ? "1 person" : `${String(count)} people`),
    areas: (count: number) => (count === 1 ? "1 sub-area" : `${String(count)} sub-areas`),
    noHead: "No head",
    noDeputies: "—",
    expand: (name: string) => `Open ${name}`,
    collapse: (name: string) => `Close ${name}`,
    seeMoreAreas: (remaining: number) => `See more sub-areas (${String(remaining)})`,
    loadingMore: "Loading…",
    inside: (parent: string) => `Inside ${parent}`,
    empty: {
      title: "There are no departments yet",
      text: "Create the first one, for example Quality or Production, and add the people in it.",
    },
    form: {
      createTitle: "New department",
      editTitle: "Edit department",
      name: "Name",
      description: "Description",
      color: "Color",
      parent: "Inside",
      noParent: "None (top level)",
      head: "Head",
      noHead: "No head",
    },
    confirmDelete: {
      title: (name: string) => `Delete the ${name} department?`,
      text: (name: string, members: number, children: number) =>
        `${name} will be deleted and this can't be undone. ${String(members)} ${members === 1 ? "person" : "people"} will no longer belong to it and will lose the access it gave them.${
          children > 0 ? ` Its ${String(children)} sub-departments move up one level.` : ""
        }`,
      action: "Delete department",
      pending: "Deleting…",
    },
    toasts: {
      created: "Department created.",
      updated: "Department updated.",
      deleted: "Department deleted.",
      membersAdded: (count: number) =>
        count === 0
          ? "They were already in the department."
          : count === 1
            ? "1 person added."
            : `${String(count)} people added.`,
      memberRemoved: "Person removed from the department.",
    },
    workspace: {
      pickTitle: "Choose a department",
      pickText: "Select one from the tree to see its people and sub-areas.",
      mine: "Your area",
      notFoundTitle: "We couldn't find this department",
      notFoundText: "It may have been deleted or it's outside your scope.",
      addPeople: "Add people",
      departmentActions: "Department actions",
      tabs: { people: "People", areas: "Sub-areas" },
      views: { label: "View", areas: "Areas", orgchart: "Org chart" },
      path: "Department path",
      head: "Head",
      deputy: "Deputy",
      position: { HEAD: "Head", DEPUTY: "Deputy", MEMBER: "Member" },
      positionOf: (name: string) => `${name}'s position`,
      removeFromDepartment: "Remove from department",
      noPeople: "This department has no people yet.",
      newArea: "New sub-area",
      noAreas: "This department has no sub-areas.",
      needsFullSeat: (name: string) =>
        `${name} is a reader: they need a full seat to act as head.`,
    },
    detail: {
      back: "Back to departments",
      members: "Members",
      searchMembers: "Search the department",
      noResults: "Nobody matches the search.",
      alreadyIn: "Already in the department",
      addMembers: "Add members",
      adding: "Adding…",
      pickMembers: "Choose who to add",
      noCandidates: "Everyone is already in this department.",
      noMembers: "This department has no members yet.",
      removeMember: (name: string) => `Remove ${name} from the department`,
      confirmRemoveMember: {
        title: (name: string, department: string) => `Remove ${name} from ${department}?`,
        text: (department: string) =>
          `They'll no longer see the documents shared with ${department}. You can add them back anytime.`,
        action: (department: string) => `Remove from ${department}`,
        pending: "Removing…",
      },
      access: "What this department sees",
      accessEmpty:
        "Once there are spaces, folders and documents, you'll see here which ones this department can access.",
    },
  },
  roles: {
    title: "Roles and permissions",
    subtitle:
      "The role sets what each person can manage; the department, what content they see.",
    create: "New role",
    system: "System roles",
    custom: "Custom roles",
    customEmpty: "There are no custom roles yet.",
    systemBadge: "System",
    base: { OWNER: "Owner", ADMIN: "Admin", MEMBER: "Member", GUEST: "Guest" },
    baseHint: {
      ADMIN: "Admin level",
      MEMBER: "Member level",
      GUEST: "External, no admin capabilities",
    },
    members: (count: number) => (count === 1 ? "1 person" : `${String(count)} people`),
    capabilities: (count: number) =>
      count === 0
        ? "No capabilities"
        : count === 1
          ? "1 capability"
          : `${String(count)} capabilities`,
    views: { list: "List", matrix: "Matrix" },
    searchPlaceholder: "Search for a role",
    filters: {
      kind: "Type",
      all: "All roles",
      system: "System",
      custom: "Custom",
    },
    noResults: { title: "No results", text: "Try another search or remove the filter." },
    form: {
      createTitle: "New role",
      editTitle: "Edit role",
      name: "Name",
      description: "Description",
      base: "Base role",
      capabilities: "Capabilities",
      notGrantable: "You can't grant this capability because you don't have it.",
      guestNoCapabilities: "A guest role has no capabilities.",
    },
    matrix: { capability: "Capability" },
    confirmDelete: {
      title: (name: string) => `Delete the ${name} role?`,
      text: (name: string) =>
        `The ${name} role will be deleted and this can't be undone. Only possible if nobody uses it.`,
      action: "Delete role",
      pending: "Deleting…",
    },
    toasts: { created: "Role created.", updated: "Role updated.", deleted: "Role deleted." },
  },
  acceptInvite: {
    title: "You're invited to join",
    subtitle: (workspace: string) => `You've been invited to ${workspace}.`,
    details: (inviter: string | null, role: string) =>
      inviter === null
        ? `You're joining with the ${role} role.`
        : `${inviter} is inviting you with the ${role} role.`,
    createAccount: "Create your account to get in.",
    name: "Full name",
    password: "Password",
    passwordHint: "At least 10 characters.",
    submit: "Accept and continue",
    submitting: "Signing in…",
    haveAccount: "This email already has an account. Sign in to accept the invitation.",
    login: "Sign in",
    signedInAs: (email: string) => `You'll join with your account ${email}.`,
    wrongAccount: (email: string) =>
      `This invitation is for ${email}. Sign out and sign in with that account.`,
    accept: "Accept invitation",
    accepting: "Accepting…",
    invalid: "The link isn't valid or has expired. Ask whoever invited you to send a new one.",
    missing: "Open this page from the link we sent you by email.",
    verifying: "Checking the invitation…",
  },
};
