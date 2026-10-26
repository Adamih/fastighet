import { queryOptions } from '@tanstack/react-query'
import { createServerFn } from '@tanstack/react-start'
import { Schema } from 'effect'
import { audit } from '#/features/audit/actions'
import { runApp } from '#/server/run'
import { once } from '#/server/submission'
import { validate } from '#/server/validate'
import {
  createProperty,
  createUnit,
  deleteProperty,
  deleteUnit,
  getProperty,
  getUnit,
  getUnitDetail,
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

const std = validate

export const listPropertiesFn = createServerFn({ method: 'GET' }).handler(() =>
  runApp(listProperties),
)

export const listUnitsFn = createServerFn({ method: 'GET' }).handler(() => runApp(listUnits))

export const getPropertyFn = createServerFn({ method: 'GET' })
  .validator(std(PropertyIdInput))
  .handler(({ data }) => runApp(getProperty(data.propertyId)))

export const createPropertyFn = createServerFn({ method: 'POST' })
  .validator(
    validate(
      Schema.Struct({
        ...CreatePropertyInput.fields,
        requestId: Schema.optional(Schema.String.check(Schema.isMaxLength(100))),
      }),
    ),
  )
  .handler(({ data }) =>
    runApp(
      once('createProperty', data, { property: ['manage'] }, createProperty(data)),
      audit('property.create'),
    ),
  )

export const updatePropertyFn = createServerFn({ method: 'POST' })
  .validator(std(UpdatePropertyInput))
  .handler(({ data }) => runApp(updateProperty(data), audit('property.update', data.propertyId)))

export const deletePropertyFn = createServerFn({ method: 'POST' })
  .validator(std(PropertyIdInput))
  .handler(({ data }) => runApp(deleteProperty(data.propertyId), audit('property.delete', null)))

export const getUnitFn = createServerFn({ method: 'GET' })
  .validator(std(UnitIdInput))
  .handler(({ data }) => runApp(getUnit(data.unitId)))

export const getUnitDetailFn = createServerFn({ method: 'GET' })
  .validator(std(UnitIdInput))
  .handler(({ data }) => runApp(getUnitDetail(data.unitId)))

export const createUnitFn = createServerFn({ method: 'POST' })
  .validator(
    validate(
      Schema.Struct({
        ...CreateUnitInput.fields,
        requestId: Schema.optional(Schema.String.check(Schema.isMaxLength(100))),
      }),
    ),
  )
  .handler(({ data }) =>
    runApp(
      once('createUnit', data, { property: ['manage'] }, createUnit(data)),
      audit('unit.create'),
    ),
  )

export const updateUnitFn = createServerFn({ method: 'POST' })
  .validator(std(UpdateUnitInput))
  .handler(({ data }) => runApp(updateUnit(data), audit('unit.update', data.unitId)))

export const deleteUnitFn = createServerFn({ method: 'POST' })
  .validator(std(UnitIdInput))
  .handler(({ data }) => runApp(deleteUnit(data.unitId), audit('unit.delete', null)))

export const propertiesQuery = () =>
  queryOptions({ queryKey: ['properties'], queryFn: () => listPropertiesFn() })

export const propertyQuery = (propertyId: string) =>
  queryOptions({
    queryKey: ['properties', propertyId],
    queryFn: () => getPropertyFn({ data: { propertyId } }),
  })

export const unitQuery = (unitId: string) =>
  queryOptions({ queryKey: ['units', unitId], queryFn: () => getUnitFn({ data: { unitId } }) })

export const unitDetailQuery = (unitId: string) =>
  queryOptions({
    queryKey: ['units', unitId, 'detail'],
    queryFn: () => getUnitDetailFn({ data: { unitId } }),
  })
export const unitsQuery = () => queryOptions({ queryKey: ['units'], queryFn: () => listUnitsFn() })
