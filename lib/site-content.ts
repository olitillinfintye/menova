import { MAX_FILE_BYTES, MODEL_FORMATS, formatBytes } from "@/lib/constants";
import { invalidRequest } from "@/lib/errors";
import { validateThumbnailFile } from "@/lib/project-thumbnails";

export interface HomeContentField {
  label: string;
  value: string;
  kind: "text" | "paragraph" | "link" | "image";
  maxLength: number;
}

function field(label: string, value: string, kind: HomeContentField["kind"] = "text", maxLength?: number): HomeContentField {
  return { label, value, kind, maxLength: maxLength ?? (kind === "paragraph" ? 800 : kind === "link" || kind === "image" ? 2048 : 120) };
}

export const HOME_CONTENT_SECTIONS = {
  hero: {
    label: "Hero",
    fields: {
      brand: field("Brand line", "Archviz. A new perspective."),
      lead: field("Opening line", "Experience", "text", 60),
      heading: field("Heading, first line", "your next", "text", 80),
      headingEnd: field("Heading, second line", "home in 3D.", "text", 80),
      body: field("Introduction", "Step inside with VR. Bring it into your world with AR. Experience every space, from anywhere.", "paragraph"),
      buttonLabel: field("Button label", "See how it works", "text", 60),
      buttonHref: field("Button link", "#workflow", "link"),
      credit: field("Studio credit", "Powered by Menova Studio"),
      imageUrl: field("Background image", "/media/archviz-ethiopian-vr.webp", "image"),
      videoLabel: field("Video accessible label", "Archviz architectural interior walkthrough"),
      phoneBrand: field("Phone brand", "Archviz", "text", 30),
      phoneMode: field("Phone mode label", "AR VIEW", "text", 30),
      phoneCaption: field("Phone caption", "Your space. In your world.", "text", 100),
      phoneLabel: field("Phone heading", "A new perspective", "text", 80),
      phoneDescription: field("Phone subtitle", "Mobile augmented reality", "text", 100),
    },
  },
  devices: {
    label: "Devices",
    fields: {
      heading: field("Heading", "Complete clarity, everywhere decisions happen.", "text", 160),
      body: field("Description", "Walk the home in VR. Review it on tablet. Share it by browser. Reopen it on mobile. One link, no installs.", "paragraph"),
      previewTitle: field("Preview title", "Riverside Pavilion"),
      previewCaption: field("Preview caption", "Interactive Space \u00b7 rendered live in the browser", "text", 200),
    },
  },
  solutions: {
    label: "Solutions",
    fields: {
      heading: field("Heading, first line", "One Space."),
      highlight: field("Highlighted text", "Five ways"),
      headingEnd: field("Heading ending", "to close the gap."),
      body: field("Description", "From sign-off to sales, Archviz turns your existing 3D models into walkable experiences your clients can understand, share and decide from.", "paragraph"),
      buttonLabel: field("Card link label", "Open card", "text", 60),
      buttonHref: field("Card link", "/dashboard", "link"),
      card1Tag: field("Card 1 category", "Design validation"),
      card1Title: field("Card 1 title", "The yes that holds"),
      card1Body: field("Card 1 description", "Help clients understand scale, flow and feel before decisions become expensive.", "paragraph"),
      card2Tag: field("Card 2 category", "Client presentations"),
      card2Title: field("Card 2 title", "Send it home"),
      card2Body: field("Card 2 description", "A walkable presentation clients can revisit, share and experience after the meeting.", "paragraph"),
      card3Tag: field("Card 3 category", "Marketing assets"),
      card3Title: field("Card 3 title", "Campaign-ready visuals"),
      card3Body: field("Card 3 description", "Turn one model into accurate 4K renders and content for every stage of the sale.", "paragraph"),
      card4Tag: field("Card 4 category", "Display homes"),
      card4Title: field("Card 4 title", "Walk every design"),
      card4Body: field("Card 4 description", "A virtual display home for every design, without the build cost.", "paragraph"),
      card5Tag: field("Card 5 category", "Off-plan sales"),
      card5Title: field("Card 5 title", "Sell before it stands"),
      card5Body: field("Card 5 description", "Give buyers the confidence to understand, share and commit before construction begins.", "paragraph"),
    },
  },
  workflow: {
    label: "Workflow",
    fields: {
      eyebrow: field("Section label", "The workflow"),
      heading: field("Heading, first line", "From what you have."),
      highlight: field("Highlighted heading", "To what they can walk through.", "text", 160),
      body: field("Description", "Upload a 3D model and Archviz turns it into a walkable space your clients can open, share and decide from \u2014 with renders created from the same source.", "paragraph"),
      buttonLabel: field("Button label", "Get Started", "text", 60),
      buttonHref: field("Button link", "/dashboard", "link"),
      step1Title: field("Step 1 title", "Start with your files"),
      step1Body: field("Step 1 description", `Export from Revit, ArchiCAD, SketchUp, 3ds Max or Blender as .glb, .fbx or .skp. Up to ${formatBytes(MAX_FILE_BYTES)} per model.`, "paragraph"),
      step2Title: field("Step 2 title", "Your Space comes to life"),
      step2Body: field("Step 2 description", "Your project becomes a walkable home clients can open on mobile, tablet, browser or headset.", "paragraph"),
      step3Title: field("Step 3 title", "Share it where decisions happen"),
      step3Body: field("Step 3 description", "Send a link, open it in a meeting, walk through it remotely or use it for sign-off.", "paragraph"),
      step4Title: field("Step 4 title", "Create visual assets on demand"),
      step4Body: field("Step 4 description", "Capture 4K renders from any viewpoint, straight from the browser, whenever you need them.", "paragraph"),
    },
  },
  formats: {
    label: "Formats",
    fields: {
      eyebrow: field("Section label", "Bring your own pipeline"),
      heading: field("Heading", "glTF, FBX"),
      highlight: field("Highlighted heading", "or SketchUp."),
      body: field("Description", "Draco, Meshopt and KTX2 compression are decoded on the fly, and FBX units are normalised to metres so 1:1 mode stays true to scale.", "paragraph"),
      glbLabel: field("GLB title", MODEL_FORMATS.glb.label),
      glbDescription: field("GLB description", MODEL_FORMATS.glb.description, "paragraph"),
      fbxLabel: field("FBX title", MODEL_FORMATS.fbx.label),
      fbxDescription: field("FBX description", MODEL_FORMATS.fbx.description, "paragraph"),
      skpLabel: field("SKP title", MODEL_FORMATS.skp.label),
      skpDescription: field("SKP description", MODEL_FORMATS.skp.description, "paragraph"),
      interactiveLabel: field("Interactive badge", "Interactive walkthrough", "text", 60),
      storedLabel: field("Storage badge", "Stored & shareable", "text", 60),
    },
  },
  callToAction: {
    label: "Call to Action",
    fields: {
      heading: field("Heading, first line", "Close the imagination gap"),
      headingEnd: field("Heading, second line", "on your next project."),
      body: field("Description", "Every step of your visualisation needs in one place.", "paragraph"),
      buttonLabel: field("Button label", "Get Started", "text", 60),
      buttonHref: field("Button link", "/dashboard", "link"),
    },
  },
  footer: {
    label: "Footer",
    fields: {
      body: field("Description", "Web-based architectural visualisation. Upload a model, share a link, walk the space on desktop, mobile or Meta Quest.", "paragraph"),
      productHeading: field("Links heading", "Product"),
      link1Label: field("Link 1 label", "Solutions", "text", 60),
      link1Href: field("Link 1 destination", "/#solutions", "link"),
      link2Label: field("Link 2 label", "Workflow", "text", 60),
      link2Href: field("Link 2 destination", "/#workflow", "link"),
      link3Label: field("Link 3 label", "Formats", "text", 60),
      link3Href: field("Link 3 destination", "/#formats", "link"),
      link4Label: field("Link 4 label", "Dashboard", "text", 60),
      link4Href: field("Link 4 destination", "/dashboard", "link"),
      link5Label: field("Link 5 label", "Contact us", "text", 60),
      link5Href: field("Link 5 destination", "/contact", "link"),
      link6Label: field("Link 6 label", "Admin", "text", 60),
      link6Href: field("Link 6 destination", "/admin", "link"),
      contactHeading: field("Contact heading", "Have questions?"),
      contactBody: field("Contact description", "Archviz is a product by Menova Studio, built for architectural presentations.", "paragraph"),
      contactLabel: field("Contact link label", "Contact us", "text", 60),
      contactHref: field("Contact link", "/contact", "link"),
      copyright: field("Copyright text", "Menova Studio. Archviz \u00b7 Architectural visualization.", "text", 200),
    },
  },
} as const;

export type HomeContentSection = keyof typeof HOME_CONTENT_SECTIONS;
export type HomeContent = {
  [Section in HomeContentSection]: { [Field in keyof typeof HOME_CONTENT_SECTIONS[Section]["fields"]]: string };
};
export interface HomeContentState {
  content: HomeContent;
  revision: number;
  updatedAt: string | null;
}
export const HOME_SECTION_KEYS = Object.keys(HOME_CONTENT_SECTIONS) as HomeContentSection[];

export function parseHomeImagePathname(pathname: unknown) {
  if (typeof pathname !== "string" || !/^site-images\/home\/[a-zA-Z0-9_-]{8,120}\.(jpg|jpeg|png|webp)$/.test(pathname)) {
    throw invalidRequest("Choose an image uploaded for the homepage.");
  }
  return { pathname, contentType: validateThumbnailFile(pathname.split("/").at(-1), 1) };
}

export function parseContentRevision(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw invalidRequest("Reload the homepage editor before saving.");
  }
  return value;
}

export function defaultHomeContent(): HomeContent {
  return Object.fromEntries(HOME_SECTION_KEYS.map((section) => [section,
    Object.fromEntries(Object.entries(HOME_CONTENT_SECTIONS[section].fields).map(([key, definition]) => [key, definition.value])),
  ])) as HomeContent;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeLink(value: string, image: boolean): boolean {
  if (/[\u0000-\u0020\\]/.test(value)) return false;
  if (value.startsWith("#")) return !image && /^#[a-zA-Z][\w-]*$/.test(value);
  if (!value.startsWith("/") && !value.startsWith("https://")) return false;
  if (value.startsWith("//")) return false;
  try {
    const url = new URL(value, "https://archviz.invalid");
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function parseHomeContent(value: unknown): HomeContent {
  if (!record(value) || Object.keys(value).some((key) => !Object.hasOwn(HOME_CONTENT_SECTIONS, key))) {
    throw invalidRequest("Choose valid homepage sections.");
  }
  const content = defaultHomeContent();
  for (const section of HOME_SECTION_KEYS) {
    const fields = HOME_CONTENT_SECTIONS[section].fields;
    const source = value[section];
    if (!record(source) || Object.keys(source).some((key) => !Object.hasOwn(fields, key))) {
      throw invalidRequest(`Check the ${HOME_CONTENT_SECTIONS[section].label} fields.`);
    }
    for (const [key, definition] of Object.entries(fields)) {
      const input = source[key];
      if (typeof input !== "string" || !input.trim() || input.trim().length > definition.maxLength
        || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(input)) {
        throw invalidRequest(`${definition.label} is required and must be ${definition.maxLength} characters or fewer.`, { section, field: key });
      }
      const text = input.trim();
      if ((definition.kind === "link" || definition.kind === "image") && !safeLink(text, definition.kind === "image")) {
        throw invalidRequest(`${definition.label} must be a site path or an HTTPS URL${definition.kind === "link" ? ", or a section anchor" : ""}.`, { section, field: key });
      }
      (content[section] as Record<string, string>)[key] = text;
    }
  }
  return content;
}