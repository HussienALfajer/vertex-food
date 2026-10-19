import { createFileRoute } from '@tanstack/react-router';
import { RestaurantSettingsScreen } from '../../features/settings/restaurant-settings-screen';

export const Route = createFileRoute('/settings/restaurant')({
  component: RestaurantSettingsScreen,
});
