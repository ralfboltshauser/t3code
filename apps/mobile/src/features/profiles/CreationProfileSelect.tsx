import { Menu } from "../../components/ui/Menu";
import { Button } from "../../components/ui/Button";
import { useMobileSidebarProfiles, selectMobileSidebarProfile } from "../../state/sidebar-profiles";

export function CreationProfileSelect() {
  const { document, activeId } = useMobileSidebarProfiles();
  if (!document.enabled) return null;
  const profile =
    document.profiles.find((p) => p.id === activeId) ??
    document.profiles.find((p) => p.id === "general");
  return (
    <Menu
      actions={document.profiles.map((p) => ({ id: p.id, title: `${p.icon} ${p.name}` }))}
      onPressAction={({ nativeEvent }) => selectMobileSidebarProfile(nativeEvent.event)}
    >
      <Button
        label={`Profile: ${profile?.name ?? "General"}`}
        accessibilityLabel="Profile for new work"
        onPress={() => {}}
      />
    </Menu>
  );
}
