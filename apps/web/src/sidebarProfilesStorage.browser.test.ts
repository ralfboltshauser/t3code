import { describe, expect, it } from "vite-plus/test";
import { transactSidebarProfiles } from "./sidebarProfilesStorage";

function removeDatabase() {
  return new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase("t3code-sidebar-profiles");
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}
async function storage() {
  await removeDatabase();
  return { [Symbol.asyncDispose]: removeDatabase };
}
describe("durable browser sidebar profiles", () => {
  it("serializes concurrent mutations without losing profiles or unrelated changes", async () => {
    await using _storage = await storage();
    await Promise.all([
      transactSidebarProfiles({ kind: "enable", enabled: true }),
      ...["work", "personal", "research"].map((id) =>
        transactSidebarProfiles({
          kind: "create",
          profile: { id, name: id, icon: "◉", color: "blue" },
        }),
      ),
    ]);
    const saved = await transactSidebarProfiles();
    expect(saved.revision).toBe(4);
    expect(saved.enabled).toBe(true);
    expect(saved.profiles.map((p) => p.id).toSorted()).toEqual([
      "general",
      "personal",
      "research",
      "work",
    ]);
    await expect(
      transactSidebarProfiles({ kind: "delete", profileId: "general", destinationId: "work" }),
    ).rejects.toThrow("General");
    expect(await transactSidebarProfiles()).toEqual(saved);
  });
});
