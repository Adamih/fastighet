import { queryOptions } from '@tanstack/react-query'
import { createServerFn } from '@tanstack/react-start'
import { Schema } from 'effect'
import { runApp } from '#/server/run'
import { createProperty, createUnit, getProperty, listProperties, listUnits } from './program'
import { CreatePropertyInput, CreateUnitInput, PropertyIdInput } from './schemas'

export const listPropertiesFn = createServerFn({ method: 'GET' }).handler(() =>
  runApp(listProperties),
)

export const listUnitsFn = createServerFn({ method: 'GET' }).handler(() => runApp(listUnits))

export const getPropertyFn = createServerFn({ method: 'GET' })
  .validator(Schema.toStandardSchemaV1(PropertyIdInput))
  .handler(({ data }) => runApp(getProperty(data.propertyId)))

export const createPropertyFn = createServerFn({ method: 'POST' })
  .validator(Schema.toStandardSchemaV1(CreatePropertyInput))
  .handler(({ data }) => runApp(createProperty(data)))

export const createUnitFn = createServerFn({ method: 'POST' })
  .validator(Schema.toStandardSchemaV1(CreateUnitInput))
  .handler(({ data }) => runApp(createUnit(data)))

export const propertiesQuery = () =>
  queryOptions({ queryKey: ['properties'], queryFn: () => listPropertiesFn() })

export const propertyQuery = (propertyId: string) =>
  queryOptions({
    queryKey: ['properties', propertyId],
    queryFn: () => getPropertyFn({ data: { propertyId } }),
  })

export const unitsQuery = () => queryOptions({ queryKey: ['units'], queryFn: () => listUnitsFn() })
