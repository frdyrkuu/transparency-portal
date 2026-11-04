/**
 * This portal's configuration: the only file a fork needs to edit.
 * What each field means: src/config.ts. Generate one with `npm run setup`;
 * check it against the live API with `npm run check`.
 *
 * Antipolo City only: search project titles across all four programs and
 * enacted budgets. Rizal DPWH offices serve other places too, so their
 * whole-office ledgers and district cards are outside this city's scope.
 */
import { defineConfig } from './src/config';

export default defineConfig({
  id: 'antipolo-city',
  kind: 'city',
  name: 'City of Antipolo',
  shortName: 'Antipolo City',
  operator: { name: 'BetterGov.ph', url: 'https://bettergov.ph' },
  // Where this example is deployed. Change it (or remove it) in your fork.
  siteUrl: 'https://transparency-portal.bettergov.workers.dev',
  scope: {
    places: [{ label: 'Antipolo City', region: 'IV-A' }],
    exclude: [
      { key: 'dpwh:house-reading:12902', reason: 'Barangay Antipolo del Sur is in Lipa City, Batangas, not Antipolo City, Rizal.' },
      { key: 'dpwh:house-reading:12912', reason: 'Barangay Antipolo del Norte is in Lipa City, Batangas, not Antipolo City, Rizal.' },
      { key: 'dpwh:house-reading:8320', reason: 'Barangay Antipolo del Sur is in Lipa City, Batangas, not Antipolo City, Rizal.' },
    ],
  },
  reporting: { enabled: false },
});
