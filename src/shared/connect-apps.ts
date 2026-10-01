/** Curated Composio toolkits shown on Apps. Slugs match the session API. */

export interface ConnectApp {
  slug: string;
  label: string;
  /** Hostname the favicon is fetched from, same as the provider rows. */
  host: string;
  /**
   * What the connection's API covers, shown on the Apps row and
   * taught to the model. An API covers less than the site does, so the
   * surprising gaps (LinkedIn has no people search, Facebook is Pages only)
   * are named here; that is what stops Buddy promising the impossible.
   */
  blurb: string;
}

/** Most people first, niche tools last. Search still finds anything in the list. */
export const CONNECT_APPS: ConnectApp[] = [
  {
    slug: "gmail",
    label: "Gmail",
    host: "mail.google.com",
    blurb:
      "Read, search, draft, and send email, and manage labels and threads.",
  },
  {
    slug: "googlecalendar",
    label: "Google Calendar",
    host: "calendar.google.com",
    blurb: "Read, create, and update events across your calendars.",
  },
  {
    slug: "slack",
    label: "Slack",
    host: "slack.com",
    blurb: "Send messages, read channels and threads, search the workspace.",
  },
  {
    slug: "googledrive",
    label: "Google Drive",
    host: "drive.google.com",
    blurb: "Search, upload, download, move, and share files.",
  },
  {
    slug: "googledocs",
    label: "Google Docs",
    host: "docs.google.com",
    blurb: "Create documents, read and edit their text.",
  },
  {
    slug: "notion",
    label: "Notion",
    host: "notion.so",
    blurb: "Search, read, create, and edit pages and databases.",
  },
  {
    slug: "googlesheets",
    label: "Google Sheets",
    host: "sheets.google.com",
    blurb: "Read and write cells, create sheets and spreadsheets.",
  },
  {
    slug: "github",
    label: "GitHub",
    host: "github.com",
    blurb: "Repos, issues, pull requests, files, and code search.",
  },
  {
    slug: "zoom",
    label: "Zoom",
    host: "zoom.us",
    blurb: "Create and manage meetings, list recordings.",
  },
  {
    slug: "discord",
    label: "Discord",
    host: "discord.com",
    blurb: "Read your profile, servers, and invites.",
  },
  {
    slug: "googlemeet",
    label: "Google Meet",
    host: "meet.google.com",
    blurb: "Create meetings and look up past ones.",
  },
  {
    slug: "youtube",
    label: "YouTube",
    host: "youtube.com",
    blurb: "Search videos, manage playlists & subscriptions, comment, upload.",
  },
  {
    slug: "pinterest",
    label: "Pinterest",
    host: "pinterest.com",
    blurb: "Create/manage your own Pins and boards. Search trends.",
  },
  {
    slug: "linkedin",
    label: "LinkedIn",
    host: "linkedin.com",
    blurb: "Share posts and comments, read your own profile and company pages.",
  },
  {
    slug: "excel",
    label: "Excel",
    host: "microsoft.com",
    blurb: "Read and write workbook cells and sheets (files in OneDrive).",
  },
  {
    slug: "googleslides",
    label: "Google Slides",
    host: "slides.google.com",
    blurb: "Create presentations and edit slides.",
  },
  {
    slug: "linear",
    label: "Linear",
    host: "linear.app",
    blurb: "Create, search, and update issues, projects, and cycles.",
  },
  {
    slug: "figma",
    label: "Figma",
    host: "figma.com",
    blurb: "Read files, components, and comments; post comments.",
  },
  {
    slug: "jira",
    label: "Jira",
    host: "atlassian.com",
    blurb: "Create, search, and update issues, projects, and sprints.",
  },
  {
    slug: "instagram",
    label: "Instagram",
    host: "instagram.com",
    blurb: "Post, comment, DM, view insights (Business/Creator only).",
  },
  {
    slug: "asana",
    label: "Asana",
    host: "asana.com",
    blurb: "Create and update tasks, projects, and comments.",
  },
  {
    slug: "clickup",
    label: "ClickUp",
    host: "clickup.com",
    blurb: "Create, search, and update tasks, lists, and spaces.",
  },
  {
    slug: "airtable",
    label: "Airtable",
    host: "airtable.com",
    blurb: "Read, create, and update records, tables, and bases.",
  },
  {
    slug: "googlephotos",
    label: "Google Photos",
    host: "photos.google.com",
    blurb: "Upload photos and manage albums.",
  },
  {
    slug: "hubspot",
    label: "HubSpot",
    host: "hubspot.com",
    blurb: "Contacts, companies, deals, tickets, and notes.",
  },
  {
    slug: "stripe",
    label: "Stripe",
    host: "stripe.com",
    blurb:
      "Customers, payments, invoices, and subscriptions in your own account.",
  },
  {
    slug: "cal",
    label: "Cal.com",
    host: "cal.com",
    blurb: "Check availability, book and manage events and event types.",
  },
  {
    slug: "facebook",
    label: "Facebook",
    host: "facebook.com",
    blurb: "Manage posts, messages, and insights for your pages.",
  },
  {
    slug: "confluence",
    label: "Confluence",
    host: "atlassian.com",
    blurb: "Search, read, create, and edit wiki pages and spaces.",
  },
  {
    slug: "google_maps",
    label: "Google Maps",
    host: "maps.google.com",
    blurb: "Search places, get details, distances, and directions.",
  },
  {
    slug: "gitlab",
    label: "GitLab",
    host: "gitlab.com",
    blurb: "Repos, issues, merge requests, and pipelines.",
  },
  {
    slug: "intercom",
    label: "Intercom",
    host: "intercom.com",
    blurb: "Conversations, contacts, and help-center articles.",
  },
  {
    slug: "bitbucket",
    label: "Bitbucket",
    host: "bitbucket.org",
    blurb: "Repos, pull requests, issues, and pipelines.",
  },
  {
    slug: "google_analytics",
    label: "Google Analytics",
    host: "analytics.google.com",
    blurb: "Read traffic and event reports from your properties.",
  },
  {
    slug: "attio",
    label: "Attio",
    host: "attio.com",
    blurb: "Read and write CRM records, lists, and notes.",
  },
  {
    slug: "supabase",
    label: "Supabase",
    host: "supabase.com",
    blurb: "Manage your projects, organizations, and databases.",
  },
  {
    slug: "basecamp",
    label: "Basecamp",
    host: "basecamp.com",
    blurb: "To-dos, messages, schedules, and projects.",
  },
  {
    slug: "googleads",
    label: "Google Ads",
    host: "ads.google.com",
    blurb: "Read campaigns and performance data in your Ads account.",
  },
  {
    slug: "eventbrite",
    label: "Eventbrite",
    host: "eventbrite.com",
    blurb: "Manage your own events, orders, and attendees.",
  },
  {
    slug: "contentful",
    label: "Contentful",
    host: "contentful.com",
    blurb: "Read and edit entries, assets, and content types.",
  },
  {
    slug: "ticketmaster",
    label: "Ticketmaster",
    host: "ticketmaster.com",
    blurb: "Search events, venues, and attractions. It can\u2019t buy tickets.",
  },
];

/**
 * The featured entry for a slug, or a bare one for a toolkit linked by slug
 * alone: the catalog is what Apps shows first, not what may be connected.
 */
export function connectAppFor(slug: string): ConnectApp {
  return (
    CONNECT_APPS.find((app) => app.slug === slug) ?? {
      slug,
      label: slug,
      host: slug,
      blurb: "Connected by slug.",
    }
  );
}

export function connectAppLabel(slug: string): string {
  return connectAppFor(slug).label;
}

/**
 * A Composio tool slug split into its app and action: "GMAIL_SEND_EMAIL" →
 * ["Gmail", "SEND_EMAIL"]. The longest catalog match wins, so google_maps
 * beats a bare "GOOGLE". Unknown apps split at the first underscore.
 */
export function splitConnectAppTool(
  tool: string,
): [app: string, action: string] {
  const upper = tool.toUpperCase();
  const app = CONNECT_APPS.filter((entry) =>
    upper.startsWith(`${entry.slug.toUpperCase()}_`),
  ).sort((a, b) => b.slug.length - a.slug.length)[0];
  if (app) return [app.label, tool.slice(app.slug.length + 1)];
  const cut = tool.indexOf("_");
  return cut > 0 ? [tool.slice(0, cut), tool.slice(cut + 1)] : [tool, tool];
}

/** "- Label: blurb" lines for the given connected slugs, for the system prompts. */
export function connectAppBlurbs(slugs: string[]): string {
  return slugs
    .map((slug) => {
      const app = CONNECT_APPS.find((entry) => entry.slug === slug);
      return app ? `- ${app.label}: ${app.blurb}` : `- ${slug}`;
    })
    .join("\n");
}
