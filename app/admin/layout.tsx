// The middleware now handles security, so this file is just for layout.

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="p-4 sm:p-6">
      <h1 className="text-xl font-semibold border-b pb-2 mb-4">Admin Panel</h1>
      {children}
    </div>
  );
}