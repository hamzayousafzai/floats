"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { archiveOrgAction } from "./actions";
import { ArrowLeft } from "lucide-react";
import type { Database } from "@/lib/database.types";

type OrgRow = Database["public"]["Tables"]["orgs"]["Row"];

// This is the client component that displays the table and handles interactions.
export default function OrgManager({ orgs }: { orgs: OrgRow[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const handleArchive = (orgId: string, orgName: string) => {
    if (window.confirm(`Are you sure you want to archive "${orgName}"?`)) {
      startTransition(async () => {
        const result = await archiveOrgAction(orgId);
        if (result.error) {
          alert(`Error: ${result.error}`);
        } else {
          router.refresh();
        }
      });
    }
  };

  return (
    <div className="p-4 sm:p-6">
      {/* Back to Admin Panel Link */}
      <div className="mb-6">
        <Link href="/admin" className="flex items-center gap-2 text-sm text-gray-600 hover:text-black w-fit">
          <ArrowLeft className="h-4 w-4" />
          Back to Admin Panel
        </Link>
      </div>

      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Organizations</h1>
        <Link href="/admin/orgs/new" className="btn btn-primary">
          New Organization
        </Link>
      </div>
      <div className="overflow-x-auto rounded-lg border bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-2 text-left font-semibold text-gray-600">Name</th>
              <th className="px-4 py-2 text-left font-semibold text-gray-600">Slug</th>
              <th className="px-4 py-2 text-left font-semibold text-gray-600">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {orgs.map((org) => (
              <tr key={org.id}>
                <td className="px-4 py-2">{org.name}</td>
                <td className="px-4 py-2 font-mono">{org.slug}</td>
                <td className="px-4 py-2 space-x-3">
                  <Link href={`/admin/orgs/${org.id}/edit`} className="text-blue-600 hover:underline">
                    Edit
                  </Link>
                  <button
                    onClick={() => handleArchive(org.id, org.name)}
                    disabled={isPending}
                    className="text-red-600 hover:underline disabled:text-gray-400"
                  >
                    Archive
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}