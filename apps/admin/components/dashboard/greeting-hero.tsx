"use client";

import { useMemo } from "react";
import { Sparkles } from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Time-of-day greetings                                              */
/* ------------------------------------------------------------------ */

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

/* ------------------------------------------------------------------ */
/*  Daily quotes — rotates based on day of year                        */
/* ------------------------------------------------------------------ */

const DAILY_QUOTES: { text: string; author: string }[] = [
  { text: "The secret of getting ahead is getting started.", author: "Mark Twain" },
  { text: "It always seems impossible until it's done.", author: "Nelson Mandela" },
  { text: "Act as if what you do makes a difference. It does.", author: "William James" },
  { text: "Success is not final, failure is not fatal: it is the courage to continue that counts.", author: "Winston Churchill" },
  { text: "What you do today can improve all your tomorrows.", author: "Ralph Marston" },
  { text: "Believe you can and you're halfway there.", author: "Theodore Roosevelt" },
  { text: "The only way to do great work is to love what you do.", author: "Steve Jobs" },
  { text: "Start where you are. Use what you have. Do what you can.", author: "Arthur Ashe" },
  { text: "In the middle of every difficulty lies opportunity.", author: "Albert Einstein" },
  { text: "Don't watch the clock; do what it does. Keep going.", author: "Sam Levenson" },
  { text: "Everything you've ever wanted is on the other side of fear.", author: "George Addair" },
  { text: "Hardships often prepare ordinary people for an extraordinary destiny.", author: "C.S. Lewis" },
  { text: "The best time to plant a tree was 20 years ago. The second best time is now.", author: "Chinese Proverb" },
  { text: "Your limitation — it's only your imagination.", author: "Unknown" },
  { text: "Dream big and dare to fail.", author: "Norman Vaughan" },
  { text: "It is never too late to be what you might have been.", author: "George Eliot" },
  { text: "The way to get started is to quit talking and begin doing.", author: "Walt Disney" },
  { text: "Don't let yesterday take up too much of today.", author: "Will Rogers" },
  { text: "You are never too old to set another goal or to dream a new dream.", author: "C.S. Lewis" },
  { text: "If you want to lift yourself up, lift up someone else.", author: "Booker T. Washington" },
  { text: "Quality is not an act, it is a habit.", author: "Aristotle" },
  { text: "A person who never made a mistake never tried anything new.", author: "Albert Einstein" },
  { text: "We may encounter many defeats but we must not be defeated.", author: "Maya Angelou" },
  { text: "Knowing is not enough; we must apply. Wishing is not enough; we must do.", author: "Johann Wolfgang von Goethe" },
  { text: "Well done is better than well said.", author: "Benjamin Franklin" },
  { text: "What lies behind us and what lies before us are tiny matters compared to what lies within us.", author: "Ralph Waldo Emerson" },
  { text: "The mind is everything. What you think you become.", author: "Buddha" },
  { text: "Strive not to be a success, but rather to be of value.", author: "Albert Einstein" },
  { text: "You miss 100% of the shots you don't take.", author: "Wayne Gretzky" },
  { text: "Whether you think you can or you think you can't, you're right.", author: "Henry Ford" },
  { text: "I have not failed. I've just found 10,000 ways that won't work.", author: "Thomas Edison" },
];

function getDailyQuote(): { text: string; author: string } {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 0);
  const dayOfYear = Math.floor(
    (now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24),
  );
  return DAILY_QUOTES[dayOfYear % DAILY_QUOTES.length];
}

/* ------------------------------------------------------------------ */
/*  GreetingHero                                                       */
/* ------------------------------------------------------------------ */

interface GreetingHeroProps {
  onRefresh?: () => void;
  refreshing?: boolean;
}

export function GreetingHero(_props: GreetingHeroProps) {
  const greeting = useMemo(getGreeting, []);
  const quote = useMemo(getDailyQuote, []);

  return (
    <div className="relative overflow-hidden rounded-xl border bg-gradient-to-br from-primary/5 via-background to-accent/10 px-6 py-5">
      {/* Decorative sparkle */}
      <div className="absolute -top-4 -right-4 opacity-[0.04]">
        <Sparkles className="h-32 w-32 text-primary" />
      </div>

      <div className="relative space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          {greeting}.
        </h1>
        <p className="text-sm italic text-muted-foreground">
          &ldquo;{quote.text}&rdquo;
          <span className="ml-1.5 not-italic text-muted-foreground/60">
            — {quote.author}
          </span>
        </p>
      </div>
    </div>
  );
}
