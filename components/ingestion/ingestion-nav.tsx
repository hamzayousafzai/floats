import Link from "next/link";

const LINKS = [
  { href: "/admin/ingestion", label: "Overview" },
  { href: "/admin/ingestion/candidates", label: "Candidates" },
  { href: "/admin/ingestion/sources", label: "Sources" },
  { href: "/admin/ingestion/runs", label: "Runs" },
] as const;

export function IngestionNav() {
  return (
    <nav aria-label="Ingestion" className="mb-4 flex flex-wrap gap-2 border-b pb-3 text-sm">
      {LINKS.map((link) => (
        <Link key={link.href} href={link.href} className="rounded bg-gray-100 px-3 py-1.5 font-medium hover:bg-gray-200">
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
