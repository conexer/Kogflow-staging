'use client';

import { Navbar } from '@/components/navbar';
import Link from 'next/link';
import Image from 'next/image';
import { UploadCloud, CheckCircle, Zap, DollarSign, LayoutTemplate, Sparkles } from 'lucide-react';
import { ComparisonSlider } from '@/components/comparison-slider';
import { HeroSlideshow } from '@/components/hero-slideshow';

export default function Home() {
  return (
    <div className="min-h-screen flex flex-col font-sans selection:bg-primary/20 bg-background text-foreground">
      <Navbar />

      <main className="flex-1 flex flex-col w-full">
        {/* Hero Section */}
        <section className="container mx-auto px-4 pt-5 pb-20 text-center space-y-8 max-w-5xl">
          <div className="relative w-full aspect-[16/9] max-w-5xl mx-auto rounded-3xl overflow-hidden shadow-2xl border border-border/50">
            {/* Slideshow */}
            <HeroSlideshow />
          </div>

          <div className="space-y-4">
            <h1 className="text-5xl md:text-7xl font-bold tracking-tight leading-tight">
              Virtually Staged with One Click
            </h1>
            <p className="text-xl md:text-2xl text-muted-foreground max-w-3xl mx-auto">
              Turn empty cold rooms into warm, inviting homes in seconds with our AI.
            </p>
          </div>

          <div className="flex flex-col items-center gap-2 pt-4">
            <Link
              href="/dashboard"
              className="px-16 py-4 bg-primary text-primary-foreground rounded-xl font-bold text-xl hover:bg-primary/90 transition-all flex items-center gap-3 shadow-xl hover:shadow-2xl hover:-translate-y-1"
            >
              <UploadCloud className="w-8 h-8" />
              Try It For Free
            </Link>
            <p className="text-sm text-muted-foreground font-medium">No sign up | No credit card</p>
          </div>
        </section>

        {/* Gallery Section */}
        <section className="bg-muted/30 py-24 border-y border-border/50">
          <div className="container mx-auto px-4 text-center space-y-12">
            <div className="space-y-4">
              <h2 className="text-3xl md:text-5xl font-bold">The Magic of Virtual Staging</h2>
              <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
                See how we turn "potential" into "perfection" instantly.
              </p>
            </div>

            <div className="max-w-4xl mx-auto rounded-2xl overflow-hidden shadow-2xl border border-border/50">
              <ComparisonSlider
                beforeImage="/images/magic-before.jpg"
                afterImage="/images/magic-after.jpg"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-8 pt-12 max-w-5xl mx-auto">
              <div className="p-6 bg-card rounded-xl border border-border shadow-sm">
                <h3 className="text-4xl font-bold text-primary mb-2">83%</h3>
                <p className="text-muted-foreground">of agents say staging helps buyers visualize a property as their future home.</p>
              </div>
              <div className="p-6 bg-card rounded-xl border border-border shadow-sm">
                <h3 className="text-xl font-bold mb-2">Sell Faster</h3>
                <p className="text-muted-foreground">Homes that are staged spend significantly less time on the market.</p>
              </div>
              <div className="p-6 bg-card rounded-xl border border-border shadow-sm">
                <h3 className="text-xl font-bold mb-2">Better Offers</h3>
                <p className="text-muted-foreground">create an emotional connection that leads to higher selling prices.</p>
              </div>
            </div>
          </div>
        </section>

        {/* Multi-View Section */}
        <section className="py-24 container mx-auto px-4">
          <div className="grid lg:grid-cols-2 gap-16 items-center max-w-6xl mx-auto">
            <div className="space-y-6">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-500/10 text-blue-500 font-medium text-sm">
                <LayoutTemplate className="w-4 h-4" /> Game changer
              </div>
              <h2 className="text-3xl md:text-5xl font-bold leading-tight">See It From Every Angle</h2>
              <p className="text-lg text-muted-foreground">
                Keep the flow consistent. Our Multi-View Staging ensures that when you stage a room from different angles, the style and furniture match perfectly.
              </p>
            </div>
            <div className="relative aspect-video rounded-3xl overflow-hidden shadow-2xl border border-border">
              <Image src="/images/hero-after.png" alt="Multi-view staging" fill className="object-cover" />
            </div>
          </div>
        </section>

        {/* Benefits Section */}
        <section className="bg-black text-white py-24">
          <div className="container mx-auto px-4">
            <div className="text-center mb-16 space-y-4">
              <span className="text-primary font-semibold tracking-wider uppercase">Why Kogflow?</span>
              <h2 className="text-3xl md:text-5xl font-bold">Staging Made Simple</h2>
            </div>

            <div className="grid md:grid-cols-3 gap-8 max-w-7xl mx-auto">
              <div className="space-y-4 p-6 rounded-2xl bg-white/5 border border-white/10 hover:bg-white/10 transition-colors">
                <CheckCircle className="w-10 h-10 text-primary" />
                <h3 className="text-xl font-bold">Totally Easy</h3>
                <p className="text-gray-400">Just upload your photo and pick a style. No design skills needed.</p>
              </div>
              <div className="space-y-4 p-6 rounded-2xl bg-white/5 border border-white/10 hover:bg-white/10 transition-colors">
                <Zap className="w-10 h-10 text-primary" />
                <h3 className="text-xl font-bold">Lightning Fast</h3>
                <p className="text-gray-400">Don't wait days for manual editors. Get results in about 15 seconds.</p>
              </div>
              <div className="space-y-4 p-6 rounded-2xl bg-white/5 border border-white/10 hover:bg-white/10 transition-colors">
                <DollarSign className="w-10 h-10 text-primary" />
                <h3 className="text-xl font-bold">Unbeatable Value</h3>
                <p className="text-gray-400">Professional staging for a fraction of the cost. Starts at just $16/mo.</p>
              </div>
            </div>
          </div>
        </section>

        {/* Steps Section */}
        <section className="py-24 container mx-auto px-4">
          <div className="text-center mb-16 space-y-4">
            <span className="text-muted-foreground font-semibold tracking-wider uppercase">How it works</span>
            <h2 className="text-3xl md:text-5xl font-bold">Three Steps to Sold</h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">We've stripped away the complexity so you can focus on closing deals.</p>
          </div>

          <div className="grid md:grid-cols-3 gap-12 max-w-6xl mx-auto text-center">
            <div className="space-y-6">
              <div className="relative aspect-[4/3] rounded-2xl overflow-hidden bg-muted shadow-md">
                <Image src="/images/magic-before.jpg" alt="Upload" fill className="object-cover" />
              </div>
              <div className="space-y-2">
                <div className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-primary text-primary-foreground font-bold mb-2">1</div>
                <h3 className="text-xl font-bold">Upload a Photo</h3>
                <p className="text-muted-foreground">Works with furnished or unfurnished rooms.</p>
              </div>
            </div>
            <div className="space-y-6">
              <div className="relative aspect-[4/3] rounded-2xl overflow-hidden bg-muted shadow-md border-2 border-primary/20">
                <div className="absolute inset-0 flex items-center justify-center bg-black/10">
                  <Sparkles className="w-16 h-16 text-white animate-pulse" />
                </div>
                <Image src="/images/magic-before.jpg" alt="Process" fill className="object-cover opacity-50" />
              </div>
              <div className="space-y-2">
                <div className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-primary text-primary-foreground font-bold mb-2">2</div>
                <h3 className="text-xl font-bold">Let AI Do The Work</h3>
                <p className="text-muted-foreground">Our intelligent system redesigns your space in seconds.</p>
              </div>
            </div>
            <div className="space-y-6">
              <div className="relative aspect-[4/3] rounded-2xl overflow-hidden bg-muted shadow-md">
                <Image src="/images/hero-after.png" alt="Download" fill className="object-cover" />
              </div>
              <div className="space-y-2">
                <div className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-primary text-primary-foreground font-bold mb-2">3</div>
                <h3 className="text-xl font-bold">Download & Share</h3>
                <p className="text-muted-foreground">Get a high-res image ready for the MLS.</p>
              </div>
            </div>
          </div>
        </section>

        {/* FAQ Section */}
        <section className="py-24 bg-muted/30 border-y border-border/50">
          <div className="container mx-auto px-4 max-w-4xl">
            <div className="text-center mb-16 space-y-4">
              <h2 className="text-3xl md:text-5xl font-bold">Got Questions? We've Got You.</h2>
              <p className="text-lg text-muted-foreground">Everything you need to know about staging with AI.</p>
            </div>

            <div className="space-y-4">
              {[
                {
                  q: "How fast is it really?",
                  a: "Blink and you might miss it. Most renders are done in about 15 seconds. No more waiting days for manual editors."
                },
                {
                  q: "Is the quality good enough for MLS?",
                  a: "Absolutely. We output high-resolution, photorealistic images that look great on Zillow, Redfin, and the MLS."
                },
                {
                  q: "Can I remove existing furniture?",
                  a: "Yes! Our 'Object Removal' mode wipes the slate clean, letting you stage messy or dated rooms from scratch."
                },
                {
                  q: "Do I need any design skills?",
                  a: "None at all. Just upload a photo, pick a style (like Modern or Scandinavian), and let our AI handle the interior design."
                },
                {
                  q: "Is it cheaper than traditional staging?",
                  a: "Way cheaper. Physical staging can cost thousands. We start at the price of a few coffees."
                }
              ].map((faq, i) => (
                <div key={i} className="bg-card border border-border rounded-xl px-6 py-4 shadow-sm">
                  <h3 className="text-lg font-bold mb-2 text-foreground">{faq.q}</h3>
                  <p className="text-muted-foreground">{faq.a}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Final CTA */}
        <section className="py-24 bg-primary text-primary-foreground text-center">
          <div className="container mx-auto px-4 space-y-8">
            <h2 className="text-3xl md:text-5xl font-bold">Ready to Transform Your Listings?</h2>
            <p className="text-xl opacity-90 max-w-2xl mx-auto">
              Experience how our quick, friendly AI can help you sell faster and for more money. Don't let your listings blend in—make them pop.
            </p>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 max-w-4xl mx-auto py-8 text-sm font-medium opacity-90">
              <div className="flex items-center justify-center gap-2"><CheckCircle className="w-5 h-5" /> Low Cost</div>
              <div className="flex items-center justify-center gap-2"><Zap className="w-5 h-5" /> Instant Results</div>
              <div className="flex items-center justify-center gap-2"><Sparkles className="w-5 h-5" /> Furniture Removal</div>
              <div className="flex items-center justify-center gap-2"><LayoutTemplate className="w-5 h-5" /> Multi-View Staging</div>
            </div>

            <div className="pt-4 flex flex-col items-center gap-2">
              <Link
                href="/dashboard"
                className="px-8 py-4 bg-white text-primary rounded-xl font-bold text-lg hover:bg-gray-100 transition-all shadow-xl inline-flex items-center gap-2"
              >
                <UploadCloud className="w-5 h-5" />
                Start Staging For Free
              </Link>
              <p className="text-sm text-primary-foreground/80 font-medium">No sign up | No credit card</p>
            </div>
          </div>
        </section>

      </main>

      <footer className="py-12 border-t border-border/40 bg-muted/20 text-sm">
        <div className="container mx-auto px-4 grid md:grid-cols-4 gap-8">
          <div className="space-y-4">
            <div className="flex items-center gap-2 font-bold text-xl tracking-tighter">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center">
                <Sparkles className="w-5 h-5 text-white" />
              </div>
              <span>Kogflow</span>
            </div>
            <p className="text-muted-foreground">
              Virtual Staging AI for Real Estate Agents.
            </p>
          </div>
          <div>
            <h4 className="font-bold mb-4">Quick Links</h4>
            <ul className="space-y-2 text-muted-foreground">
              <li><Link href="/" className="hover:text-foreground">Home</Link></li>
              <li><Link href="/history" className="hover:text-foreground">Gallery</Link></li>
              <li><Link href="/pricing" className="hover:text-foreground">Pricing</Link></li>
              <li><Link href="/login" className="hover:text-foreground">Log in</Link></li>
            </ul>
          </div>
          <div>
            <h4 className="font-bold mb-4">Legal</h4>
            <ul className="space-y-2 text-muted-foreground">
              <li><Link href="#" className="hover:text-foreground">Terms of Service</Link></li>
              <li><Link href="#" className="hover:text-foreground">Privacy Policy</Link></li>
            </ul>
          </div>
          <div>
            <h4 className="font-bold mb-4">Contact</h4>
            <ul className="space-y-2 text-muted-foreground">
              <li>contact@kogflow.com</li>
            </ul>
          </div>
        </div>
        <div className="container mx-auto px-4 mt-12 pt-8 border-t border-border/20 text-center text-muted-foreground">
          <p>© 2026 Kogflow. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
