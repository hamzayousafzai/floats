import { createSupabaseServer } from "@/lib/supabase/server";

export const revalidate = 0;

export default async function TestPage() {
  const supabase = await createSupabaseServer();
  const { data, error } = await supabase.from("vendors").select("*").limit(2);

  return (
    <main className="p-4">
      <h1 className="font-semibold text-lg">Supabase Test</h1>
      {error && <p className="text-red-600">Error: {error.message}</p>}
      <pre className="bg-gray-100 p-2 text-xs">
        {JSON.stringify(data, null, 2)}
      </pre>
    </main>
  );
}
