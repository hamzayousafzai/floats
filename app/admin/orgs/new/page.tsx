"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

// Helper to generate a URL-friendly slug from a string
const slugify = (text: string) =>
  text
    .toString()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w-]+/g, '')
    .replace(/--+/g, '-');

export default function NewOrgForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newName = e.target.value;
    setName(newName);
    setSlug(slugify(newName));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    const response = await fetch('/admin/orgs/new/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, slug }),
    });

    if (response.ok) {
      router.push('/admin/orgs');
      router.refresh(); // Refresh the orgs list
    } else {
      const { error } = await response.json();
      setError(error || "An unknown error occurred.");
      setIsSubmitting(false);
    }
  };

  return (
    <div className="p-4 sm:p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">New Organization</h1>
        <Link href="/admin/orgs" className="flex items-center gap-2 text-sm text-gray-600 hover:text-black">
          <ArrowLeft className="h-4 w-4" />
          Back to Organizations
        </Link>
      </div>
      <form onSubmit={handleSubmit} className="max-w-lg bg-white p-6 rounded-lg border space-y-4">
        <div>
          <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1">
            Organization Name
          </label>
          <input
            id="name"
            type="text"
            value={name}
            onChange={handleNameChange}
            className="input input-bordered w-full"
            required
            placeholder="e.g., My Awesome Company"
          />
        </div>
        <div>
          <label htmlFor="slug" className="block text-sm font-medium text-gray-700 mb-1">
            Slug (URL)
          </label>
          <input
            id="slug"
            type="text"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            className="input input-bordered w-full font-mono"
            required
            placeholder="e.g., my-awesome-company"
          />
          <p className="text-xs text-gray-500 mt-1">Auto-generated from name. Must be unique.</p>
        </div>
        {error && <p className="text-sm text-error">{error}</p>}
        <div className="flex justify-end">
          <button type="submit" className="btn btn-primary" disabled={isSubmitting}>
            {isSubmitting ? "Creating..." : "Create Organization"}
          </button>
        </div>
      </form>
    </div>
  );
}