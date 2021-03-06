/*
 * Licensed to Elasticsearch B.V. under one or more contributor
 * license agreements. See the NOTICE file distributed with
 * this work for additional information regarding copyright
 * ownership. Elasticsearch B.V. licenses this file to you under
 * the Apache License, Version 2.0 (the "License"); you may
 * not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

import { set } from '@elastic/safer-lodash-set';
import {
  FormattedData,
  TabularData,
  TabularDataValue,
} from '../../../../../../plugins/inspector/common';
import { Filter } from '../../../es_query';
import { FormatFactory } from '../../../field_formats/utils';
import { TabbedTable } from '../../tabify';
import { createFilter } from './create_filter';

/**
 * Type borrowed from the client-side FilterManager['addFilters'].
 *
 * We need to use a custom type to make this isomorphic since FilterManager
 * doesn't exist on the server.
 *
 * @internal
 */
export type AddFilters = (filters: Filter[] | Filter, pinFilterStatus?: boolean) => void;

/**
 * This function builds tabular data from the response and attaches it to the
 * inspector. It will only be called when the data view in the inspector is opened.
 *
 * @internal
 */
export async function buildTabularInspectorData(
  table: TabbedTable,
  {
    addFilters,
    deserializeFieldFormat,
  }: {
    addFilters?: AddFilters;
    deserializeFieldFormat: FormatFactory;
  }
): Promise<TabularData> {
  const aggConfigs = table.columns.map((column) => column.aggConfig);
  const rows = table.rows.map((row) => {
    return table.columns.reduce<Record<string, FormattedData>>((prev, cur, colIndex) => {
      const value = row[cur.id];

      let format = cur.aggConfig.toSerializedFieldFormat();
      if (Object.keys(format).length < 1) {
        // If no format exists, fall back to string as a default
        format = { id: 'string' };
      }
      const fieldFormatter = deserializeFieldFormat(format);

      prev[`col-${colIndex}-${cur.aggConfig.id}`] = new FormattedData(
        value,
        fieldFormatter.convert(value)
      );
      return prev;
    }, {});
  });

  const columns = table.columns.map((col, colIndex) => {
    const field = col.aggConfig.getField();
    const isCellContentFilterable = col.aggConfig.isFilterable() && (!field || field.filterable);
    return {
      name: col.name,
      field: `col-${colIndex}-${col.aggConfig.id}`,
      filter:
        addFilters &&
        isCellContentFilterable &&
        ((value: TabularDataValue) => {
          const rowIndex = rows.findIndex(
            (row) => row[`col-${colIndex}-${col.aggConfig.id}`].raw === value.raw
          );
          const filter = createFilter(aggConfigs, table, colIndex, rowIndex, value.raw);

          if (filter) {
            addFilters(filter);
          }
        }),
      filterOut:
        addFilters &&
        isCellContentFilterable &&
        ((value: TabularDataValue) => {
          const rowIndex = rows.findIndex(
            (row) => row[`col-${colIndex}-${col.aggConfig.id}`].raw === value.raw
          );
          const filter = createFilter(aggConfigs, table, colIndex, rowIndex, value.raw);

          if (filter) {
            const notOther = value.raw !== '__other__';
            const notMissing = value.raw !== '__missing__';
            if (Array.isArray(filter)) {
              filter.forEach((f) => set(f, 'meta.negate', notOther && notMissing));
            } else {
              set(filter, 'meta.negate', notOther && notMissing);
            }
            addFilters(filter);
          }
        }),
    };
  });

  return { columns, rows };
}
