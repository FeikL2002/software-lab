/** Provider instructions checked against official documentation on 2026-10-28. */
export const importHelp: {
  gmail: string[];
  aol: string[];
  sourceUrl: { gmail: string; aol: string };
  sources: Record<string, string>;
  verifiedAt: string;
} = {
  gmail: [
    "Sign in to your own Gmail account in a browser. Search for receipts, subscription renewals, memberships, free trials, or the name of a service.",
    "For one message, open it, choose the More menu beside Reply, then Download message. Import the downloaded .eml file here. You can select several .eml files together.",
    "To paste instead, open the message's More menu, choose Show original, then Copy to clipboard. Paste the original message here so the sender, subject, date, and receipt text stay together.",
    "For a larger scan, open Google Takeout, deselect other products, select Mail, and choose the labels you want if that option is available. Choose Next step, a one-time export, and create the export.",
    "When Google's archive is ready, download and extract it on your computer. Import the mail file ending in .mbox here. Large exports may need to be split into smaller exports or receipt labels to fit this app's file limit.",
    "Repeat for each Gmail account you own. Keep account passwords and verification codes in Google's sign-in page; this import process does not need them.",
  ],
  aol: [
    "Sign in to your own account at mail.aol.com. Search for receipts, subscriptions, renewals, memberships, trials, or a service name. AOL's Advanced search can narrow the results.",
    "Open a message, choose the More menu, then View Raw Message. Copy the full raw message, including the headers and body, and paste it here.",
    "If raw-message view is unavailable, copy the receipt text with its sender address, subject, and date. Include those details above the body when you paste it here.",
    "For files you already have, import .eml or .mbox messages exported by your desktop mail app. AOL's official bulk-download route uses a separate desktop email app with IMAP; it is not a one-click inbox export from AOL webmail.",
    "For a larger import, follow AOL's official IMAP download guide in a desktop mail app you trust, keep mail on the server, and download full messages for offline use. Then export the messages from that app in a supported format.",
    "Use AOL's own sign-in flow when your mail app supports it. An older app may require an AOL-generated app password; enter it only in that mail app, never in this subscription finder. Repeat the import for each AOL account you own.",
  ],
  sourceUrl: {
    gmail: "https://support.google.com/mail/answer/9261412?hl=en",
    aol: "https://help.aol.com/articles/use-full-headers-to-find-delivery-delays-or-a-forged-email-s-true-address-in-new-aol-mail",
  },
  sources: {
    gmailDownload: "https://support.google.com/mail/answer/9261412?hl=en",
    gmailOriginal: "https://support.google.com/mail/answer/29436?hl=en",
    gmailTakeout: "https://support.google.com/accounts/answer/3024190?hl=en",
    aolRawMessage: "https://help.aol.com/articles/use-full-headers-to-find-delivery-delays-or-a-forged-email-s-true-address-in-new-aol-mail",
    aolSearch: "https://help.aol.com/articles/search-for-messages-in-new-aol-mail",
    aolDownload: "https://help.aol.com/articles/download-your-email-from-aol-mail-with-imap",
    aolImap: "https://help.aol.com/articles/how-do-i-use-other-email-applications-to-send-and-receive-my-aol-mail",
    aolAppPasswords: "https://help.aol.com/articles/create-and-manage-app-password",
    aolOAuth: "https://senders.yahooinc.com/developer/documentation/",
    aolDeveloperAccess: "https://senders.yahooinc.com/developer/developer-access/",
  },
  verifiedAt: "2026-10-28",
};
