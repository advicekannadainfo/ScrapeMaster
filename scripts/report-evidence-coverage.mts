// Run with: npx tsx --conditions=react-server scripts/report-evidence-coverage.mts
// Writes only to stdout; never connects to a database or provider.
import { buildEvidenceCoverage } from '../tests/support/evidence-coverage';
process.stdout.write(`${JSON.stringify(buildEvidenceCoverage(), null, 2)}\n`);
