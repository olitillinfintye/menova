import type { Metadata } from "next";
import { SiteNav } from "@/app/components/SiteNav";
import { ContactForm } from "@/app/contact/ContactForm";

export const metadata: Metadata = { title: "Contact us" };

export default function ContactPage() {
  return (
    <>
      <SiteNav />
      <main className="relative mx-auto max-w-6xl px-5 py-12 sm:px-8 sm:py-20">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
          <header>
            <p className="text-sm text-[var(--color-accent)]">Menova Studio</p>
            <h1 className="font-display mt-4 text-4xl font-bold">Contact us</h1>
            <p className="mt-5 max-w-sm leading-relaxed text-[var(--color-muted)]">Your next space starts with a conversation.</p>
            <img src="/brand/archviz-mark.png" alt="Archviz" width={96} height={96} className="mt-10 h-24 w-24 object-contain" />
          </header>
          <ContactForm />
        </div>
      </main>
    </>
  );
}