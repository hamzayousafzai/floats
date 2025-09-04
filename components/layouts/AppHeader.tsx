"use client";
export default function AppHeader() {
  return (
    <header
      id="app-header"
      className="fixed top-0 inset-x-0 z-[9000] border-b bg-white/90 backdrop-blur supports-[backdrop-filter]:bg-white/70"
      style={{
        // Header height variable (content height) + safe area
        ["--floats-header-h" as any]: "56px",
        ["--floats-header-total" as any]:
          "calc(var(--floats-header-h) + env(safe-area-inset-top))",
      }}
    >
      <div className="mx-auto max-w-md h-[calc(var(--floats-header-total))] flex items-center justify-center px-5 pt-[env(safe-area-inset-top)]">
        <h1 className="text-lg font-semibold tracking-tight text-sky-900">Floats</h1>
      </div>
    </header>
  );
}