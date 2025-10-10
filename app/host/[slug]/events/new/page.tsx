"use client";

import EditEventForm from "@/components/admin/EditEventForm";
import { useHost } from "@/lib/contexts/HostContext";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { Loader2, ArrowLeft } from "lucide-react"; // Import ArrowLeft
import { useEffect, useState } from "react";
import Link from "next/link"; // Import Link

// FIX: Change category id type to string
type Category = { id: string; name: string; };

export default function NewHostEventPage() {
  // FIX: Get role from useHost
  const { currentOrg, role, loading: hostLoading } = useHost();
  const [categories, setCategories] = useState<Category[]>([]);
  const [loadingCategories, setLoadingCategories] = useState(true);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    const fetchCategories = async () => {
      const { data, error } = await supabase.from('categories').select('id, name');
      if (error) {
        console.error("Failed to fetch categories:", error);
      } else if (data) {
        // FIX: Remove the faulty map and filter. Use the data directly.
        setCategories(data || []);
      }
      setLoadingCategories(false);
    };
    fetchCategories();
  }, []);

  const isLoading = hostLoading || loadingCategories;

  if (isLoading) {
    return (
      <div className="flex justify-center items-center p-12">
        <Loader2 className="animate-spin" />
      </div>
    );
  }

  if (!currentOrg) {
    return <p className="p-6">Organization not found.</p>;
  }

  return (
    <div className="p-4 sm:p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">Create New Event</h1>
        <Link href={`/host/${currentOrg.slug}`} className="btn btn-ghost">
          <ArrowLeft size={16} className="mr-2" />
          Cancel
        </Link>
      </div>
      {/* FIX: Pass role to the form */}
      <EditEventForm orgId={currentOrg.id} allCategories={categories} role={role} />
    </div>
  );
}