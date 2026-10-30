import {
  businessWallClock,
  CSV_BOM,
  CSV_EOL,
  type ExportColumn,
  exportCsv,
  exportHeaderCells,
} from '@vertex-food/contracts';
import type { ExportDataset } from '@vertex-food/db';
import { ar } from '@vertex-food/i18n';

// The two Arabic files of an export (spec S06 "CSV and ZIP format"): `README.txt` and
// `columns.csv`, from the `dataExport` namespace, which a test in `packages/db` checks against
// every dataset and column.

type DatasetTexts = { title: string; columns: Record<string, string> };

const texts = ar.dataExport;
const datasetTexts: Record<string, DatasetTexts> = texts.datasets;

function textsOf(stem: string): DatasetTexts {
  const found = datasetTexts[stem];
  if (!found) throw new Error(`The dataset ${stem} has no Arabic texts`);
  return found;
}

/** `YYYY-MM-DD HH:mm` on the Damascus clock. */
function damascusTime(instant: Date): string {
  const { date, minutes } = businessWallClock(instant);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date} ${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

/** `README.txt`: UTF-8 with a byte-order mark and CRLF, so Notepad shows the Arabic. */
export function exportReadme(datasets: readonly ExportDataset[], asOf: Date): string {
  const { readme } = texts;
  const lines = [
    readme.title,
    '',
    readme.asOf.replace('{{asOf}}', damascusTime(asOf)),
    '',
    readme.contents,
    readme.offline,
    readme.privacy,
    '',
    readme.files,
    ...datasets.map((dataset) => `${dataset.stem}.csv: ${textsOf(dataset.stem).title}`),
    readme.columnsFile,
    readme.manifestFile,
    readme.filesFolder,
    '',
    readme.format,
  ];
  return CSV_BOM + lines.join(CSV_EOL) + CSV_EOL;
}

/**
 * `columns.csv`: every header cell of every file with its column's Arabic description. Its own
 * header row is Arabic: the owner reads this file, no program does.
 */
export function exportColumnsCsv(datasets: readonly ExportDataset[]): string {
  const { file, column, description } = texts.columnsHeader;
  const columns: readonly ExportColumn[] = [file, column, description].map((name) => ({
    name,
    kind: 'text',
  }));
  const rows = datasets.flatMap((dataset) => {
    const described = textsOf(dataset.stem).columns;
    return dataset.columns.flatMap((each) =>
      exportHeaderCells(each).map((cell) => ({
        [file]: `${dataset.stem}.csv`,
        [column]: cell,
        [description]: described[each.name] ?? '',
      })),
    );
  });
  return exportCsv(columns, rows);
}
