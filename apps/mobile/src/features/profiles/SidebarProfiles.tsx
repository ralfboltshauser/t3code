import { useState } from "react";
import { Modal, ScrollView, Switch, TextInput, View } from "react-native";
import { SIDEBAR_PROFILE_COLORS, type SidebarProfileMutation } from "@t3tools/contracts";
import {
  ALL_PROFILES_ID,
  GENERAL_PROFILE_ID,
  sidebarProfileForProject,
  sidebarProfileForEnvironment,
} from "@t3tools/client-runtime/sidebar-profiles";
import { Button } from "../../components/ui/Button";
import { AppText as Text } from "../../components/ui/AppText";
import { Menu } from "../../components/ui/Menu";
import * as Dialog from "../../components/ui/Dialog";
import {
  useMobileSidebarProfiles,
  mutateMobileSidebarProfiles,
  selectMobileSidebarProfile,
} from "../../state/sidebar-profiles";
import { useProjects } from "../../state/entities";
import { useEnvironments } from "../../state/environments";
import { uuidv4 } from "../../lib/uuid";

export function MobileSidebarProfiles({ labs = false }: { labs?: boolean }) {
  const { document, activeId, error } = useMobileSidebarProfiles();
  const [open, setOpen] = useState(false);
  const report = (cause: unknown) =>
    Dialog.alert("Profiles not saved", cause instanceof Error ? cause.message : "Try again.");
  if (!labs && !document.enabled) return null;
  return (
    <View className="gap-2 px-4 py-2">
      {labs ? (
        <View className="flex-row items-center justify-between">
          <Text>Sidebar profiles</Text>
          <Switch
            accessibilityLabel="Sidebar profiles"
            value={document.enabled}
            onValueChange={(enabled) => {
              void mutateMobileSidebarProfiles({ kind: "enable", enabled }).catch(report);
            }}
          />
        </View>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerClassName="gap-2"
        >
          <View className="flex-row gap-2">
            {document.profiles.map((profile) => (
              <Button
                key={profile.id}
                size="compact"
                label={`${profile.icon} ${profile.name}`}
                tone={activeId === profile.id ? "primary" : "text"}
                onPress={() => selectMobileSidebarProfile(profile.id)}
              />
            ))}
            <Button
              size="compact"
              label="All"
              tone={activeId === ALL_PROFILES_ID ? "primary" : "text"}
              onPress={() => selectMobileSidebarProfile(ALL_PROFILES_ID)}
            />
          </View>
        </ScrollView>
      )}
      {error ? <Text className="text-danger">{error}</Text> : null}
      <Button size="compact" tone="text" label="Manage profiles" onPress={() => setOpen(true)} />
      {open ? (
        <Modal
          animationType="slide"
          presentationStyle="pageSheet"
          onRequestClose={() => setOpen(false)}
        >
          <MobileProfileManager onClose={() => setOpen(false)} />
        </Modal>
      ) : null}
    </View>
  );
}
function MobileProfileManager({ onClose }: { onClose: () => void }) {
  const { document } = useMobileSidebarProfiles();
  const projects = useProjects();
  const { environments } = useEnvironments();
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("◉");
  const [color, setColor] = useState<(typeof SIDEBAR_PROFILE_COLORS)[number]>("slate");
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (mutation: SidebarProfileMutation) => {
    setBusy(true);
    setError(null);
    try {
      await mutateMobileSidebarProfiles(mutation);
      setBusy(false);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Cannot save profiles.");
      setBusy(false);
      return false;
    }
  };
  const actions = document.profiles.map((p) => ({ id: p.id, title: `${p.icon} ${p.name}` }));
  return (
    <View className="flex-1 bg-screen pt-6">
      <ScrollView
        contentContainerClassName="gap-5 px-5 pb-12"
        contentInsetAdjustmentBehavior="automatic"
      >
        <View className="flex-row items-center justify-between">
          <Text className="text-xl font-t3-semibold">Sidebar profiles</Text>
          <Button label="Done" size="compact" onPress={onClose} />
        </View>
        <Text className="text-foreground-muted">
          Profiles are saved on this device. Environment defaults apply to new and unassigned
          projects.
        </Text>
        {error ? (
          <Text accessibilityRole="alert" className="text-danger">
            {error}
          </Text>
        ) : null}
        {document.profiles.map((profile, index) => (
          <View key={profile.id} className="gap-2 border-b border-border pb-3">
            <Text>
              {profile.icon} {profile.name}
            </Text>
            <View className="flex-row flex-wrap gap-2">
              <Button
                label="Edit"
                size="compact"
                disabled={busy}
                onPress={() => {
                  setEditing(profile.id);
                  setName(profile.name);
                  setIcon(profile.icon);
                  setColor(profile.color);
                }}
              />
              {[-1, 1].map((delta) => (
                <Button
                  key={delta}
                  size="compact"
                  label={delta < 0 ? "↑" : "↓"}
                  accessibilityLabel={`Move ${profile.name} ${delta < 0 ? "up" : "down"}`}
                  disabled={busy || index + delta < 0 || index + delta >= document.profiles.length}
                  onPress={() => {
                    const ids = document.profiles.map((p) => p.id);
                    ids.splice(index, 1);
                    ids.splice(index + delta, 0, profile.id);
                    void run({ kind: "reorder", profileIds: ids });
                  }}
                />
              ))}
              {profile.id !== GENERAL_PROFILE_ID ? (
                <Menu
                  actions={actions.filter((p) => p.id !== profile.id)}
                  onPressAction={({ nativeEvent }) =>
                    Dialog.confirm({
                      title: `Delete ${profile.name}?`,
                      message:
                        "Projects and environment defaults move to the selected destination. Chats and files are preserved.",
                      confirmText: "Delete profile",
                      destructive: true,
                      onConfirm: () => {
                        void run({
                          kind: "delete",
                          profileId: profile.id,
                          destinationId: nativeEvent.event,
                        });
                      },
                    })
                  }
                >
                  <Button
                    label="Delete into…"
                    tone="danger"
                    size="compact"
                    disabled={busy}
                    onPress={() => {}}
                  />
                </Menu>
              ) : null}
            </View>
          </View>
        ))}
        <Text>{editing ? "Edit profile" : "New profile"}</Text>
        <TextInput
          accessibilityLabel="Profile name"
          className="min-h-12 rounded-lg border border-border px-3 text-foreground"
          value={name}
          maxLength={64}
          placeholder="Profile name"
          onChangeText={setName}
        />
        <TextInput
          accessibilityLabel="Profile icon"
          className="min-h-12 rounded-lg border border-border px-3 text-foreground"
          value={icon}
          maxLength={16}
          onChangeText={setIcon}
        />
        <Menu
          actions={SIDEBAR_PROFILE_COLORS.map((c) => ({ id: c, title: c }))}
          onPressAction={({ nativeEvent }) => {
            const next = SIDEBAR_PROFILE_COLORS.find((c) => c === nativeEvent.event);
            if (next) setColor(next);
          }}
        >
          <Button label={`Color: ${color}`} onPress={() => {}} />
        </Menu>
        <Button
          label={editing ? "Save profile" : "Create profile"}
          disabled={busy || !name.trim()}
          onPress={() => {
            void run({
              kind: editing ? "edit" : "create",
              profile: { id: editing ?? uuidv4(), name, icon, color },
            }).then((saved) => {
              if (saved) {
                setEditing(null);
                setName("");
              }
            });
          }}
        />
        <Text className="text-lg font-t3-semibold">Environment defaults</Text>
        {environments.map((environment) => (
          <Menu
            key={environment.environmentId}
            actions={actions}
            onPressAction={({ nativeEvent }) => {
              void run({
                kind: "assign-environment",
                environmentId: environment.environmentId,
                profileId: nativeEvent.event,
              });
            }}
          >
            <View className="min-h-12 justify-center">
              <Text>
                {environment.label} ·{" "}
                {
                  document.profiles.find(
                    (p) =>
                      p.id === sidebarProfileForEnvironment(document, environment.environmentId),
                  )?.name
                }
              </Text>
            </View>
          </Menu>
        ))}
        <Text className="text-lg font-t3-semibold">Projects</Text>
        {projects.map((project) => (
          <Menu
            key={`${project.environmentId}:${project.id}`}
            actions={[{ id: "inherit", title: "Use environment default" }, ...actions]}
            onPressAction={({ nativeEvent }) => {
              void run({
                kind: "assign-projects",
                projects: [{ environmentId: project.environmentId, projectId: project.id }],
                profileId: nativeEvent.event === "inherit" ? null : nativeEvent.event,
              });
            }}
          >
            <View className="min-h-14 justify-center border-b border-border">
              <Text>
                {project.title} ·{" "}
                {
                  document.profiles.find(
                    (p) =>
                      p.id ===
                      sidebarProfileForProject(document, {
                        environmentId: project.environmentId,
                        projectId: project.id,
                      }),
                  )?.name
                }
              </Text>
              <Text className="text-xs text-foreground-muted">
                {environments.find((e) => e.environmentId === project.environmentId)?.label ??
                  project.environmentId}
              </Text>
            </View>
          </Menu>
        ))}
      </ScrollView>
    </View>
  );
}
