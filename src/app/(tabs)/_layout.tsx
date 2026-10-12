import { Tabs } from 'expo-router';
import { StyleSheet } from 'react-native';

import { Icon, type IconName } from '@/components/ui/Icon';
import { colors, typography } from '@/constants/theme';

type TabDefinition = {
  name: string;
  title: string;
  icon: IconName;
  iconFocused: IconName;
};

const tabs: readonly TabDefinition[] = [
  // Urutan tiap entri menentukan urutan tab; `ringkasan` adalah tab pertama.
  { name: 'ringkasan', title: 'Ringkasan', icon: 'home-outline', iconFocused: 'home' },
  { name: 'rides', title: 'Perjalanan', icon: 'navigate-outline', iconFocused: 'navigate' },
  { name: 'community', title: 'Komunitas', icon: 'people-outline', iconFocused: 'people' },
  { name: 'hazards', title: 'Peringatan', icon: 'warning-outline', iconFocused: 'warning' },
  { name: 'profile', title: 'Profil', icon: 'person-outline', iconFocused: 'person' },
];

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.text.accent,
        tabBarHideOnKeyboard: true,
        tabBarInactiveTintColor: colors.text.muted,
        tabBarLabelStyle: styles.label,
        tabBarStyle: styles.tabBar,
      }}
    >
      {tabs.map((tab) => (
        <Tabs.Screen
          key={tab.name}
          name={tab.name}
          options={{
            title: tab.title,
            tabBarAccessibilityLabel: tab.title,
            tabBarIcon: ({ color, focused }) => (
              <Icon name={focused ? tab.iconFocused : tab.icon} size={22} color={color} />
            ),
          }}
        />
      ))}
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: colors.background.elevated,
    borderTopColor: colors.border.subtle,
    borderTopWidth: StyleSheet.hairlineWidth * 2,
  },
  label: {
    ...typography.overline,
    fontSize: 11,
    letterSpacing: 0.2,
    textTransform: 'none',
  },
});
