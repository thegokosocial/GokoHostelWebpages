export function useAdminApi(password: string) {
  const apiCall = async (body: Record<string, any>) => {
    const res = await fetch("/api/admin/checkins", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password, ...body }),
    });
    return res;
  };

  return { apiCall };
}
