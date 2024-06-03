import * as CDX from '@cyclonedx/cyclonedx-library'

interface ValidatorMap {
    [key: string]: CDX.Validation.Types.Validator;
}
const validatorsMap: ValidatorMap = {};
for (const value of Object.values(CDX.Spec.Version)) {
    validatorsMap[value.toString()] = new CDX.Validation.JsonStrictValidator(value);
}

export default async function validateBom(data: any): Promise<boolean> {
    try {
        const validator: CDX.Validation.Types.Validator = validatorsMap[data.specVersion]
        if (!validator) {
            throw new Error('Unsupported schema version: ' + data.specVersion)
        }

        const validationErrors = await validator.validate(JSON.stringify(data))
        if (validationErrors === null) {
            console.info('JSON valid')
        } else {
            throw new Error('JSON Validation Error:\n' + JSON.stringify(validationErrors))
        }
    } catch (err) {
        if (err instanceof CDX.Validation.MissingOptionalDependencyError) {
            console.info('JSON validation skipped:', err)
        } else {
            console.error(err)
            throw err
        }
    }

    return true
}