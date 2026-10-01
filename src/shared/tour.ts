// What Buddy says on its own during the first run: a hello at sign-in, one
// line as each walk step opens, and a short tour once the walk is done. Fixed
// text, spoken from the dot. No model is asked.

import type { PermissionName } from "./types";

/** Which Settings page a tour stop opens, when it opens one. */
export type TourStopId =
  | "intro"
  | "chats"
  | "brain"
  | "apps"
  | "browser"
  | "phone"
  | "shopping"
  | "buy"
  | "memory"
  | "suggestions"
  | "jobs"
  | "agent"
  | "texts"
  | "skills"
  | "airplane"
  | "account";

export interface TourStop {
  id: TourStopId;
  line: string;
  /** The Settings page this stop shows. */
  page?: string;
}

/** The first thing Buddy says once someone is signed in and the walk is up. */
export function helloLine(firstName: string): string {
  return `${firstName ? `Hey ${firstName}.` : "Hey."} I'm Buddy. Let's get you set up.`;
}

/**
 * A walk step's line. The name step checks the name the hello just used, and
 * only asks when there is none. The permissions step names what is still
 * missing: a relaunch mid-grant lands back on it with some already allowed.
 */
export function walkLine(
  step: string,
  firstName: string,
  missingPermissions: PermissionName[] = [],
): string | undefined {
  if (step === "name" && firstName)
    return `Is ${firstName} what you go by? Change it here if not.`;
  if (step === "permissions") return permissionsLine(missingPermissions);
  return WALK_LINES[step];
}

const PERMISSION_NAMES: Record<PermissionName, string> = {
  microphone: "the microphone",
  screen: "screen recording",
  accessibility: "accessibility",
};

function permissionsLine(missing: PermissionName[]): string {
  if (missing.length === 3)
    return "I need to hear, see, and click. Grant each one, and drag me into the lists it opens.";
  if (missing.length === 0)
    return "Awesome. You've allowed everything I need here. On to the next step.";
  const names = missing.map((name) => PERMISSION_NAMES[name]);
  const list =
    names.length === 1
      ? names[0]
      : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
  return `Looks like we still need ${list} allowed to continue.`;
}

/** One line per walk step, said as the step opens. */
const WALK_LINES: Record<string, string> = {
  name: "First, what should I call you?",
  hotkey:
    "Hold the keys, say hi, and let go. I only listen to your voice when they're down.",
  voice: "Pick how I sound. Press play to hear each one.",
  story:
    "Tell me about yourself. Hold the keys and talk, or type it. I'll remember.",
  apps: "Connect the accounts you want me to reach. You can skip this. But, I highly reccomend adding at least one or two. It makes me way more helpful.",
  browser:
    "I have my own browser for getting things done on the web. Bring your sign-ins over, so I'm already logged in where you are.",
  texts:
    "Give me my own iMessage thread, then send a test from your phone. If your messages are sending twice in a row, double check the instructions here.",
  drawing: "Watch this. I can draw right on your screen.",
};

/** Said after the drawing step's ring lands, naming what it circled (null when no window could be drawn on). */
export function drawingLine(circled: string | null): string {
  return circled
    ? `That's ${circled}. Ask me where anything is, and I'll circle it like that.`
    : "Ask me where anything is, and I'll circle it right on your screen.";
}

/** The tour after the walk: an introduction with the chat closed, the chat, then Settings. */
export function tourStops(firstName: string, waitlisted: boolean): TourStop[] {
  const name = firstName ? `, ${firstName}` : "";
  const intro = waitlisted
    ? `Glad you're here${name}. I'm opening up to a small group at a time, so you're on the waitlist for now. You can still ask me things and text me, a handful of times a day. It refills at midnight. Know someone already on Buddy? Their code moves you up. Let me give you a quick tour. Press Escape anytime to skip it.`
    : `Glad you're here${name}. You're all set. Let me give you a quick tour. Press Escape anytime to skip it.`;
  return [
    { id: "intro", line: intro },
    {
      id: "chats",
      line: "This is where our conversations live. All our dialogue can be found here, and you can type to me too.",
    },
    {
      id: "brain",
      page: "brain",
      line: "Brain is where you pick which large language model I use to think hard and fast. You can choose from any model you have access to in the cloud, run your own with Ollama, and switch at any time.",
    },
    {
      id: "browser",
      page: "browser",
      line: "This where you control all the sites I can use in my own browser. I navigate them the same way you would, and do what you need me to do while you focus on more important things. Bring your sign-ins over from your favorite browser and I'm logged in wherever you are.",
    },
    {
      id: "apps",
      page: "apps",
      line: "Apps is where you connect your accounts, like Gmail and Calendar. Once they're linked, I can work with them directly, so things get done fast. The more you connect, the more I can help.",
    },
    {
      id: "phone",
      page: "phone",
      line: "These are settings for my phone. I can call places for you, like booking a table or checking if that shoe is in stock. Pick the voice I use on calls here, and when a call ends I'll tell you how it went.",
    },
    {
      id: "shopping",
      page: "shopping",
      line: "Shopping is how I show you what I find: one pick at a time, a quick rundown, or every option at once.",
    },
    {
      id: "buy",
      page: "buy",
      line: "Checkout Forms holds your shipping address and a card. When a store doesn't have them saved, I fill them in for you when you buy in my browser.",
    },
    {
      id: "memory",
      page: "memory",
      line: "Memory is what I know about you, and about the people you mention. I add to it as we talk, and you can edit any line.",
    },
    {
      id: "suggestions",
      page: "suggestions",
      line: "Suggestions are things I offer to take on proactively, from your chats, inbox, and calendar, like a note before a meeting or food before a flight. Pick when they come, and whether I text them to you.",
    },
    {
      id: "jobs",
      page: "jobs",
      line: "Jobs are things you want me to do on a schedule or on demand. A morning email & calendar brief, a daily reservation at a new restaurant in your neighborhood, whatever you set.",
    },
    {
      id: "agent",
      page: "agent",
      line: "Computer Use is how I actually take the wheel of your computer. A bunch of settings here, feel free to ask me about them anytime.",
    },
    {
      id: "texts",
      page: "texts",
      line: "Text Buddy is our iMessage thread. Text me from your phone and I answer from this Mac as long as your Mac is awake.",
    },
    {
      id: "skills",
      page: "skills",
      line: "Skills are instructions I keep. Some load on their own when their app is in front. You can add more skills here, and remove ones you don't want me to use.",
    },
    {
      id: "airplane",
      page: "airplane",
      line: "Airplane Mode keeps me working on this Mac, even when you're offline. I'm simpler that way, but nothing leaves your computer. One catch though. Your Mac needs pretty good hardware to keep my answers quick.",
    },
    {
      id: "account",
      page: "account",
      line: "And Account is where you manage basic info, your plan, see how much you've used, check for version updates, and more. That's the tour. Hold the speak keys whenever you need me, and if you don't feel like talking out loud, you can always just double tap the control key, or shoot me a text on imessage.",
    },
  ];
}
