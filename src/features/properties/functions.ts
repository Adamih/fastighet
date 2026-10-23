import { queryOptions } from '@tanstack/react-query'
import { createServerFn } from '@tanstack/react-start'
import { Schema } from 'effect'
import { runApp } from '#/server/run'
import {
  createProperty,
  createUnit,
  deleteProperty,
  deleteUnit,
  getProperty,
  getUnit,
  listProperties,
  listUnits,
  updateProperty,
  updateUnit,
} from './program'
import {
  CreatePropertyInput,
  CreateUnitInput,
  PropertyIdInput,
  UnitIdInput,
  UpdatePropertyInput,
  UpdateUnitInput,
} from './schemas'

const std = Schema.toStandardSchemaV1

export const listPropertiesFn = createServerFn({ method: 'GET' }).handler(() =>
  runApp(listProperties),
)

export const listUnitsFn = createServerFn({ method: 'GET' }).handler(() => runApp(listUnits))

export const getPropertyFn = createServerFn({ method: 'GET' })
  .validator(std(PropertyIdInput))
  .handler(({ data }) => runApp(getProperty(data.propertyId)))

export const createPropertyFn = createServerFn({ method: 'POST' })
  .validator(std(CreatePropertyInput))
  .handler(({ data }) => runApp(createProperty(data)))

export const updatePropertyFn = createServerFn({ method: 'POST' })
  .validator(std(UpdatePropertyInput))
  .handler(({ data }) => runApp(updateProperty(data)))

export const deletePropertyFn = createServerFn({ method: 'POST' })
  .validator(std(PropertyIdInput))
  .handler(({ data }) => runApp(deleteProperty(data.propertyId)))

export const getUnitFn = createServerFn({ method: 'GET' })
  .validator(std(UnitIdInput))
  .handler(({ data }) => runApp(getUnit(data.unitId)))

export const createUnitFn = createServerFn({ method: 'POST' })
  .validator(std(CreateUnitInput))
  .handler(({ data }) => runApp(createUnit(data)))

export const updateUnitFn = createServerFn({ method: 'POST' })
  .validator(std(UpdateUnitInput))
  .handler(({ data }) => runApp(updateUnit(data)))

export const deleteUnitFn = createServerFn({ method: 'POST' })
  .validator(std(UnitIdInput))
  .handler(({ data }) => runApp(deleteUnit(data.unitId)))

export const propertiesQuery = () =>
  queryOptions({ queryKey: ['properties'], queryFn: () => listPropertiesFn() })

export const propertyQuery = (propertyId: string) =>
  queryOptions({
    queryKey: ['properties', propertyId],
    queryFn: () => getPropertyFn({ data: { propertyId } }),
  })

export const unitQuery = (unitId: string) =>
  queryOptions({ queryKey: ['units', unitId], queryFn: () => getUnitFn({ data: { unitId } }) })

export const unitsQuery = () => queryOptions({ queryKey: ['units'], queryFn: () => listUnitsFn() })
