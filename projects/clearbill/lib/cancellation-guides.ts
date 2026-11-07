/**
 * Cancellation instructions checked against official help pages on 2026-10-28.
 * Every outbound URL is a curated constant. Email content never becomes a URL.
 */
export type CancellationGuide = {
  name: string;
  domain: string;
  url: string;
  steps: string[];
  note: string;
  verifiedAt: string;
};

const checkedOn = "2026-10-28";
const emailNotice = "Unsubscribing from marketing email does not cancel a paid subscription.";
const partnerNotice = "If another company bills you, cancel with that billing provider.";

export const guides: CancellationGuide[] = [
  {
    name: "Netflix", domain: "netflix.com", url: "https://help.netflix.com/en/node/407",
    steps: ["Sign in to Netflix and open Manage your membership.", "Choose Cancel, then Finish Cancellation.", "Save the confirmation email and check the membership end date in your account."],
    note: `${partnerNotice} If Netflix has no cancel option, check Membership for your payment partner. Deleting the app does not cancel membership.`, verifiedAt: checkedOn,
  },
  {
    name: "Spotify", domain: "spotify.com", url: "https://support.spotify.com/us/article/cancel-premium/",
    steps: ["Sign in to your Spotify account and open Manage your plan.", "Choose Cancel subscription and finish the confirmation steps.", "Check when Premium ends; playlists and saved music remain on the free account."],
    note: "If cancellation is unavailable, check Payment for the billing partner. Only the Family or Duo plan manager can cancel the whole plan. A zero-priced trial can end immediately.", verifiedAt: checkedOn,
  },
  {
    name: "Amazon Prime", domain: "amazon.com", url: "https://www.aboutamazon.com/news/retail/how-to-cancel-amazon-prime-membership",
    steps: ["Sign in to Amazon and open Accounts & Lists, then Prime Membership.", "Open Manage Membership and choose End Membership.", "Complete every cancellation prompt and save the confirmation and membership end date."],
    note: "Check that the charge is for Prime. Appstore subscriptions, Audible, and Prime Video Channels can have separate billing and cancellation settings.", verifiedAt: checkedOn,
  },
  {
    name: "Disney+", domain: "disneyplus.com", url: "https://help.disneyplus.com/en-GB/article/disneyplus-en-qa-cancel",
    steps: ["Sign in to Disney+ in a web browser.", "Choose your profile, then Account, then the subscription under Subscription.", "Choose Cancel Subscription and finish the prompts. Check the subscription end date."],
    note: `${partnerNotice} For a Hulu-billed bundle, check Hulu. Cancellation does not delete your MyDisney account; menus can vary by region.`, verifiedAt: checkedOn,
  },
  {
    name: "Hulu", domain: "hulu.com", url: "https://help.hulu.com/article/hulu-cancel-hulu-subscription",
    steps: ["Sign in to Hulu's Account page in a web browser.", "Under Your Subscription choose Cancel. If offered a pause, choose Continue to Cancel to proceed.", "Choose Cancel Subscription. Check the account's cancellation status and save the confirmation email."],
    note: "Check Payment Information for the billing provider. Third-party and bundle billing can require different steps. Hulu + Live TV free trials can end immediately when canceled.", verifiedAt: checkedOn,
  },
  {
    name: "Apple / App Store", domain: "apple.com", url: "https://support.apple.com/en-us/118428",
    steps: ["On iPhone or iPad open Settings, tap your name, then Subscriptions. The official guide also has a web option.", "Choose the subscription and tap Cancel Subscription, then follow the confirmation.", "Check its expiration date. If the Cancel button is absent and an expiration message appears, Apple says it is already canceled."],
    note: "Use the Apple Account shown on the receipt. If Apple has no receipt or subscription, check who actually bills you. Cancel an unwanted trial at least 24 hours before it ends.", verifiedAt: checkedOn,
  },
  {
    name: "iCloud+", domain: "icloud.com", url: "https://support.apple.com/en-us/108318",
    steps: ["Before changing storage, download or remove content above your new storage allowance.", "On iOS 18.4 or later open Settings, tap your name, then Subscriptions, then iCloud+.", "Choose Cancel Subscription and follow the prompts. For older iOS, Mac, or Windows, follow the device-specific official guide."],
    note: "The change takes effect after the current billing period. Losing paid storage can affect syncing and backups; review the storage warning before confirming.", verifiedAt: checkedOn,
  },
  {
    name: "Google Play", domain: "play.google.com", url: "https://support.google.com/googleplay/answer/7018481?hl=en",
    steps: ["Sign in to the Google Account that purchased the subscription and open subscriptions on Google Play.", "Find the subscription and choose Manage, then Cancel subscription.", "Choose a reason and Continue through the confirmation. Check that the subscription has an end date."],
    note: "On Android, open Play Store, profile, Payments & subscriptions, then Subscriptions. Uninstalling an app does not cancel its subscription. Only use this route for Google Play-billed purchases.", verifiedAt: checkedOn,
  },
  {
    name: "YouTube Premium", domain: "youtube.com", url: "https://support.google.com/youtube/answer/6308278?hl=en",
    steps: ["Sign in to YouTube and open Purchases and memberships (youtube.com/paid_memberships).", "Choose Manage membership, Deactivate, then Continue to cancel.", "Choose a reason, continue, and select Yes, cancel. Check the membership end date."],
    note: "If Apple or Google Play bills the membership, cancel in that provider's subscriptions settings. Paid benefits usually continue to the end of the billing period.", verifiedAt: checkedOn,
  },
  {
    name: "Microsoft 365", domain: "microsoft.com", url: "https://support.microsoft.com/en-us/accounts-billing/subscriptions/cancel-a-microsoft-365-subscription",
    steps: ["Sign in to the Microsoft account used for the purchase and open Services & subscriptions.", "Choose Cancel subscription (sometimes shown as Upgrade or Cancel).", "Review the terms and storage effects, finish the cancellation, and check the end date. 'Turn on recurring billing' means renewal is already off."],
    note: "App store and retailer purchases must be managed with that seller. A lower storage allowance can affect OneDrive and Outlook email; review storage before canceling.", verifiedAt: checkedOn,
  },
  {
    name: "Adobe", domain: "adobe.com", url: "https://helpx.adobe.com/account/individual/subscriptions-and-plans/renewals-and-cancellations/cancel-adobe-subscription.html",
    steps: ["Sign in to your Adobe account. Under Plans and payment choose Manage plan.", "Choose Cancel your plan, review the plan details, and Continue to cancel.", "Choose a reason, review the cancellation terms and any fee, then Confirm cancellation. Save the confirmation and check your account."],
    note: "Annual plans billed monthly can carry an early cancellation fee. Review the exact terms before confirming. Cancel each plan separately; third-party purchases use the seller's process.", verifiedAt: checkedOn,
  },
  {
    name: "Dropbox", domain: "dropbox.com", url: "https://help.dropbox.com/plans/downgrade-dropbox-individual-plans",
    steps: ["For an individual plan, sign in to Dropbox, open your avatar, then Manage account.", "Choose Cancel plan, select a reason, and Continue canceling or Confirm change through the prompts.", "Save the confirmation email and check Billing for the scheduled downgrade."],
    note: "App store purchases must be canceled with the app store. Family and team plans have separate instructions in the guide. Review the lower storage allowance before downgrading; deleting the app does not cancel billing.", verifiedAt: checkedOn,
  },
  {
    name: "Audible", domain: "audible.com", url: "https://help.audible.com/s/article/cancel-membership?language=en_US",
    steps: ["Sign in to the Audible website and select your name, then Membership details.", "Choose Cancel membership, then Confirm cancellation through the prompts.", "Check Membership details shows the change and save the confirmation email."],
    note: "Review unused credits before canceling; purchased titles remain accessible. Apple- or Google-billed memberships must be canceled in that app store. Deleting Audible does not cancel membership.", verifiedAt: checkedOn,
  },
  {
    name: "Planet Fitness", domain: "planetfitness.com", url: "https://www.planetfitness.com/about-planet-fitness/customer-service",
    steps: ["Review your membership agreement, billing dates, notice period, and any minimum term.", "Use the member portal on Planet Fitness's website, visit your home club, or mail a written request to your home club, according to your agreement and location.", "Ask for written confirmation and the final billing date. Keep a copy of the request."],
    note: "Policies vary by club and location. Planet Fitness currently advises cancellation at least 7 days before monthly or annual billing; a minimum-term buyout fee may apply. Other gyms have their own agreements.", verifiedAt: checkedOn,
  },
  {
    name: "HBO Max", domain: "hbomax.com", url: "https://help.hbomax.com/us/Answer/Detail/000002526",
    steps: ["Sign in to HBO Max and open Subscription. Check who bills you at the top.", "If billed directly by HBO Max, choose Cancel Your Subscription.", "Confirm cancellation and record the expiration date. If another provider bills you, use that provider's cancellation route in the official guide."],
    note: "Cancel before the next billing date. The official guide covers Apple, Google, Amazon, Roku, TV providers, and other partners. Deleting the app does not cancel the subscription.", verifiedAt: checkedOn,
  },
];

const fallback: CancellationGuide = {
  name: "Check the billing provider",
  domain: "",
  url: "",
  steps: [
    "Confirm the merchant and billing provider on your receipt or bank statement. An email alone does not prove a subscription is still active.",
    "Open the provider's official app or type its known website yourself. Find Account, Billing, Membership, or Subscriptions.",
    "Review the agreement, renewal date, notice period, and any cancellation fee. For a gym, follow the specific club's written agreement.",
    "Follow the provider's cancellation process, then save written confirmation and check the final billing date. If no option is available, contact support through the official website.",
  ],
  note: `${emailNotice} No verified merchant-specific link is available here. Do not share your password, full card number, or a verification code with this app.`,
  verifiedAt: "",
};

function normalizeDomain(value: string): string {
  const candidate = value.trim().toLowerCase();
  if (!candidate) return "";
  try {
    const parsed = new URL(candidate.includes("://") ? candidate : `https://${candidate}`);
    return parsed.hostname.replace(/^www\./, "").replace(/\.$/, "");
  } catch {
    return "";
  }
}

function matchesDomain(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

function copyGuide(guide: CancellationGuide): CancellationGuide {
  return { ...guide, steps: [...guide.steps] };
}

/** Billing provider takes precedence over the merchant when explicitly known. */
export function getCancellationGuide(domain: string, billingVia?: string): CancellationGuide {
  const billing = (billingVia ?? "").trim().toLowerCase();
  if (["apple", "app store", "appstore", "apple app store"].includes(billing)) {
    return copyGuide(guides.find((guide) => guide.domain === "apple.com")!);
  }
  if (["google", "google play", "googleplay", "play store"].includes(billing)) {
    return copyGuide(guides.find((guide) => guide.domain === "play.google.com")!);
  }
  if (["amazon", "amazon appstore", "amazon app store", "prime video channels"].includes(billing)) {
    return {
      ...copyGuide(fallback),
      name: "Amazon-billed subscription",
      domain: "amazon.com",
      steps: [
        "Sign in through Amazon's official website and confirm whether the bill is for Prime, an Appstore subscription, a Prime Video Channel, or another membership.",
        "Open that service's subscription or membership settings and follow its cancellation process. These are separate services; ending Prime may not resolve every Amazon charge.",
        "Review the final billing date and save the account's cancellation confirmation. If you cannot find the purchase, contact Amazon support through its official website.",
      ],
      note: `Use the correct Amazon account and service. ${emailNotice}`,
    };
  }

  const host = normalizeDomain(domain);
  // Aliases are explicitly listed, never guessed from arbitrary email content.
  const aliases: Record<string, string> = {
    "max.com": "hbomax.com",
  };
  const alias = Object.entries(aliases).find(([from]) => matchesDomain(host, from));
  const normalizedHost = alias ? alias[1] : host;
  const found = [...guides]
    .sort((a, b) => b.domain.length - a.domain.length)
    .find((guide) => matchesDomain(normalizedHost, guide.domain));
  return copyGuide(found ?? fallback);
}
