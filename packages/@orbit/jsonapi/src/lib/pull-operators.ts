import { Dict, toArray, merge } from '@orbit/utils';
import {
  Query,
  QueryExpressionParseError,
  Transform,
  FindRecord,
  FindRecords,
  FindRelatedRecord,
  FindRelatedRecords,
  FilterSpecifier,
  SortSpecifier,
  AttributeFilterSpecifier,
  RelatedRecordFilterSpecifier,
  AttributeSortSpecifier,
  buildTransform,
  RelatedRecordsFilterSpecifier
} from '@orbit/data';
import JSONAPISource from '../jsonapi-source';
import { JSONAPIDocument } from '../jsonapi-document';
import { RequestOptions, buildFetchSettings, customRequestOptions } from './request-settings';

function deserialize(source: JSONAPISource, document: JSONAPIDocument): Transform[] {
  const deserialized = source.serializer.deserializeDocument(document);
  const records = toArray(deserialized.data);

  if (deserialized.included) {
    Array.prototype.push.apply(records, deserialized.included);
  }

  const operations = records.map(record => {
    return {
      op: 'replaceRecord',
      record
    };
  });

  return [buildTransform(operations)];
}

export interface PullOperator {
  (source: JSONAPISource, query: Query): any;
}

export const PullOperators: Dict<PullOperator> = {
  findRecord(source: JSONAPISource, query: Query) {
    const expression = query.expression as FindRecord;
    const { record } = expression;

    const requestOptions = customRequestOptions(source, query);
    const settings = buildFetchSettings(requestOptions);

    return source.fetch(source.resourceURL(record.type, record.id), settings)
      .then(data => deserialize(source, data));
  },

  findRecords(source: JSONAPISource, query: Query) {
    const expression = query.expression as FindRecords;
    const { type } = expression;

    let requestOptions: RequestOptions = {};

    if (expression.filter) {
      requestOptions.filter = buildFilterParam(source, expression.filter);
    }

    if (expression.sort) {
      requestOptions.sort = buildSortParam(source, expression.sort);
    }

    if (expression.page) {
      requestOptions.page = expression.page;
    }

    let customOptions = customRequestOptions(source, query);
    if (customOptions) {
      merge(requestOptions, customOptions);
    }

    const settings = buildFetchSettings(requestOptions);

    return source.fetch(source.resourceURL(type), settings)
      .then(data => deserialize(source, data));
  },

  findRelatedRecord(source: JSONAPISource, query: Query) {
    const expression = query.expression as FindRelatedRecord;
    const { record, relationship } = expression;

    const requestOptions = customRequestOptions(source, query);
    const settings = buildFetchSettings(requestOptions);

    return source.fetch(source.relatedResourceURL(record.type, record.id, relationship), settings)
      .then(data => deserialize(source, data));
  },

  findRelatedRecords(source: JSONAPISource, query: Query) {
    const expression = query.expression as FindRelatedRecords;
    const { record, relationship } = expression;

    let requestOptions = customRequestOptions(source, query);

    const settings = buildFetchSettings(requestOptions);

    return source.fetch(source.relatedResourceURL(record.type, record.id, relationship), settings)
      .then(data => deserialize(source, data));
  }
};

function buildFilterParam(source: JSONAPISource, filterSpecifiers: FilterSpecifier[]) {
  const filters = {};

  filterSpecifiers.forEach(filterSpecifier => {
    if (filterSpecifier.kind === 'attribute' && filterSpecifier.op === 'equal') {
      const attributeFilter = filterSpecifier as AttributeFilterSpecifier;

      // Note: We don't know the `type` of the attribute here, so passing `null`
      const resourceAttribute = source.serializer.resourceAttribute(null, attributeFilter.attribute);
      filters[resourceAttribute] = attributeFilter.value;
    } else if (filterSpecifier.kind === 'relatedRecord') {
      const relatedRecordFilter = filterSpecifier as RelatedRecordFilterSpecifier;
      if (Array.isArray(relatedRecordFilter.record)) {
        filters[relatedRecordFilter.relation] = relatedRecordFilter.record.map(e => e.id).join(',');
      } else {
        filters[relatedRecordFilter.relation] = relatedRecordFilter.record.id;
      }
    } else if (filterSpecifier.kind === 'relatedRecords') {
      if (filterSpecifier.op !== 'equal') {
        throw new Error(`Operation "${filterSpecifier.op}" is not supported in JSONAPI for relatedRecords filtering`);
      }
      const relatedRecordsFilter = filterSpecifier as RelatedRecordsFilterSpecifier;
      filters[relatedRecordsFilter.relation] = relatedRecordsFilter.records.map(e => e.id).join(',');
    } else {
      throw new QueryExpressionParseError('Filter operation ${specifier.op} not recognized for JSONAPISource.', filterSpecifier);
    }
  });

  return filters;
}

function buildSortParam(source: JSONAPISource, sortSpecifiers: SortSpecifier[]) {
  return sortSpecifiers.map(sortSpecifier => {
    if (sortSpecifier.kind === 'attribute') {
      const attributeSort = sortSpecifier as AttributeSortSpecifier;

      // Note: We don't know the `type` of the attribute here, so passing `null`
      const resourceAttribute = source.serializer.resourceAttribute(null, attributeSort.attribute);
      return (sortSpecifier.order === 'descending' ? '-' : '') + resourceAttribute;
    }
    throw new QueryExpressionParseError('Sort specifier ${sortSpecifier.kind} not recognized for JSONAPISource.', sortSpecifier);
  }).join(',');
}
