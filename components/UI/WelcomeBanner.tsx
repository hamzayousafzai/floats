"use client";

import { useState, useEffect } from "react";

const LOCAL_STORAGE_KEY = "hasSeenWelcomeBanner";

export default function WelcomeBanner() {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    // This code runs only on the client after the component mounts
    const hasSeenBanner = localStorage.getItem(LOCAL_STORAGE_KEY);

    // If the flag is not set in localStorage, show the banner
    if (!hasSeenBanner) {
      setIsOpen(true);
    }
  }, []);

  const handleDismiss = () => {
    // Hide the banner for the current session
    setIsOpen(false);
    // Set the flag in localStorage so it doesn't show again
    localStorage.setItem(LOCAL_STORAGE_KEY, "true");
  };

  if (!isOpen) {
    return null;
  }

  return (
    // This container centers the card without a backdrop.
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
      {/* This is the actual DaisyUI Card with a border. */}
      <div className="card w-full max-w-md bg-base-100 shadow-xl relative animate-fade-in-up pointer-events-auto border border-gray-200">
        {/* The card body now centers its text content. */}
        <div className="card-body items-center text-center">
          {/* Close button positioned inside the card body */}
          {/* We must re-enable pointer-events on this container for the button to be clickable. */}
          <div className="card-actions justify-end absolute top-2 right-2 pointer-events-auto">
            {/* The close button is now larger (default medium size). */}
            <button
              onClick={handleDismiss}
              aria-label="Dismiss welcome banner"
              className="btn btn-circle btn-ghost"
            >
              ✕
            </button>
          </div>

          <h2 className="card-title">Welcome to Floats!</h2>
          <p>
            Discover Charlotte’s best local markets, pop-ups, and hidden gems.
            Explore the map, save your favorites, set reminders, and never miss an
            event again.
          </p>
        </div>
      </div>
    </div>
  );
}