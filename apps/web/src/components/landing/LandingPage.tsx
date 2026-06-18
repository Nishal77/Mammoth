import { Navbar } from "./Navbar.tsx";
import { HeroSection } from "./HeroSection.tsx";
import { MetricsSection } from "./MetricsSection.tsx";
import { DepartmentsSection } from "./DepartmentsSection.tsx";
import { RingsSection } from "./RingsSection.tsx";
import { PricingSection } from "./PricingSection.tsx";
import { CtaSection } from "./CtaSection.tsx";
import { Footer } from "./Footer.tsx";

/**
 * Public marketing landing page.
 * Rendered at "/" — no auth required.
 * Sections: Navbar, Hero, Metrics, Departments, Rings, Pricing, CTA, Footer.
 */
export function LandingPage() {
  return (
    <div style={{ minHeight: "100vh", backgroundColor: "var(--bg)" }}>
      <Navbar />
      <main>
        <HeroSection />
        <MetricsSection />
        <DepartmentsSection />
        <RingsSection />
        <PricingSection />
        <CtaSection />
      </main>
      <Footer />
    </div>
  );
}
