import { useGT } from "gt-react-native";
import { Menu } from "../../components/ui/Menu";
import { Button } from "../../components/ui/Button";
import { useMobileSidebarProfiles, selectMobileSidebarProfile } from "../../state/sidebar-profiles";

export function CreationProfileSelect() {
  const gt = useGT();
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
        label={gt("Profile: {value0}", { value0: profile?.name ?? "General" })}
        accessibilityLabel={gt("Profile for new work")}
        onPress={() => {}}
      />
    </Menu>
  );
}
