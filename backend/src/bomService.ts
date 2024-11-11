import * as BomRepository from './bomRespository';
import { fetchFromOci, pushToOci } from './ociService';
import { BomDto, BomInput, BomRecord, BomSearch, HIERARCHICHAL, RebomOptions, SearchObject } from './types';
import validateBom from './validateBom';
  const utils = require('./utils')

  async function bomRecordToDto(bomRecord: BomRecord): Promise<BomDto> {
    let version = ''
    let group = ''
    let name = ''
    let bomVersion = ''
    if(process.env.OCI_STORAGE_ENABLED){
      bomRecord.bom = fetchFromOci(bomRecord.meta.serialNumber)
    }
    if (bomRecord.bom) bomVersion = bomRecord.bom.version
    if (bomRecord.bom && bomRecord.bom.metadata && bomRecord.bom.metadata.component) {
        version = bomRecord.bom.metadata.component.version
        name = bomRecord.bom.metadata.component.name
        group = bomRecord.bom.metadata.component.group
    }
    let bomDto: BomDto = {
        uuid: bomRecord.uuid,
        createdDate: bomRecord.created_date,
        lastUpdatedDate: bomRecord.last_updated_date,
        meta: bomRecord.meta,
        bom: bomRecord.bom,
        tags: bomRecord.tags,
        organization: bomRecord.organization,
        public: bomRecord.public,
        bomVersion: bomVersion,
        group: group,
        name: name,
        version: version,
    }
    return bomDto
}

  export async function findAllBoms(): Promise<BomDto[]> {
    let bomRecords = await BomRepository.findAllBoms();
    return await Promise.all(bomRecords.map(async(b) => bomRecordToDto(b)))
  }

  export async function findBomObjectById(id: string): Promise<Object> {
    let bomById = (await BomRepository.bomById(id))[0]
    let bomDto = await bomRecordToDto(bomById)
    console.log("bom by ID:", bomDto)
    return bomDto.bom
  }

  export async function findBom(bomSearch: BomSearch): Promise<BomDto[]> {
    let searchObject = {
      queryText: `select * from rebom.boms where 1 = 1`,
      queryParams: [],
      paramId: 1
    }

    let bomDtos: BomDto[] = []

    if (bomSearch.bomSearch.singleQuery) {
      bomDtos = await findBomViaSingleQuery(bomSearch.bomSearch.singleQuery)
    } else {
      if (bomSearch.bomSearch.serialNumber) {
        if (!bomSearch.bomSearch.serialNumber.startsWith('urn')) {
          bomSearch.bomSearch.serialNumber = 'urn:uuid:' + bomSearch.bomSearch.serialNumber
        }
        updateSearchObj(searchObject, `bom->>'serialNumber'`, bomSearch.bomSearch.serialNumber)
      }

      if (bomSearch.bomSearch.version) updateSearchObj(searchObject, `bom->>'version'`, bomSearch.bomSearch.version)

      if (bomSearch.bomSearch.componentVersion) updateSearchObj(searchObject, `bom->'metadata'->'component'->>'version'`,
        bomSearch.bomSearch.componentVersion)

      if (bomSearch.bomSearch.componentGroup) updateSearchObj(searchObject, `bom->'metadata'->'component'->>'group'`,
        bomSearch.bomSearch.componentGroup)

      if (bomSearch.bomSearch.componentName) updateSearchObj(searchObject, `bom->'metadata'->'component'->>'name'`,
        bomSearch.bomSearch.componentName)

      let queryRes = await utils.runQuery(searchObject.queryText, searchObject.queryParams)
      let bomRecords = queryRes.rows as BomRecord[]
      bomDtos = await  Promise.all(bomRecords.map(async(b) => bomRecordToDto(b)))
    }
    return bomDtos
  }

  export async function findBomByMeta(bomMeta: RebomOptions): Promise<BomDto[]> {
    let bomDtos: BomDto[] = []
    const queryText = 'SELECT * FROM rebom.boms WHERE meta = $1::jsonb;';
    const values = [JSON.stringify(bomMeta)];
    
    let queryRes = await utils.runQuery(queryText, values)
    let bomRecords = queryRes.rows as BomRecord[]
    if(bomRecords.length)
      bomDtos = await Promise.all(bomRecords.map(async(b) => bomRecordToDto(b)))
    
    return bomDtos
  }


  export async function findBomViaSingleQuery(singleQuery: string): Promise<BomDto[]> {
    let proceed: boolean = false
    // 1. search by uuid
    let queryRes = await utils.runQuery(`select * from rebom.boms where bom->>'serialNumber' = $1`, [singleQuery])
    proceed = (queryRes.rows.length < 1)

    if (proceed) {
      queryRes = await utils.runQuery(`select * from rebom.boms where bom->>'serialNumber' = $1`, ['urn:uuid:' + singleQuery])
      proceed = (queryRes.rows.length < 1)
    }

    // 2. search by name
    if (proceed) {
      queryRes = await utils.runQuery(`select * from rebom.boms where bom->'metadata'->'component'->>'name' like $1`, ['%' + singleQuery + '%'])
      proceed = (queryRes.rows.length < 1)
    }

    // 3. search by group
    if (proceed) {
      queryRes = await utils.runQuery(`select * from rebom.boms where bom->'metadata'->'component'->>'group' like $1`, ['%' + singleQuery + '%'])
      proceed = (queryRes.rows.length < 1)
    }

    // 3. search by version
    if (proceed) {
      queryRes = await utils.runQuery(`select * from rebom.boms where bom->'metadata'->'component'->>'version' = $1`, [singleQuery])
      proceed = (queryRes.rows.length < 1)
    }

    let bomRecords = queryRes.rows as BomRecord[]
    return await Promise.all(bomRecords.map(async(b) => bomRecordToDto(b)))
  }

  export function updateSearchObj(searchObject: SearchObject, queryPath: string, addParam: string) {
    searchObject.queryText += ` AND ${queryPath} = $${searchObject.paramId}`
    searchObject.queryParams.push(addParam)
    ++searchObject.paramId
  }

  export async function exportMergedBom(ids: string[], rebomOptions: RebomOptions): Promise<any> {
    return JSON.stringify(mergeBoms(ids, rebomOptions))
  }

  export async function mergeBoms(ids: string[], rebomOptions: RebomOptions): Promise<any> {
    try {
      var mergedBom = null
      let bomObjs = await findBomsForMerge(ids, rebomOptions.tldOnly)
      if (bomObjs && bomObjs.length)
        mergedBom = await mergeBomObjects(bomObjs, rebomOptions)
      return mergedBom
    } catch (e) {
      console.error("Error During merge", e)
      throw e
    }
  }

  export async function mergeAndStoreBoms(ids: string[], rebomOptions: RebomOptions): Promise<any> {
    try {
      let mergedBom = await  mergeBoms(ids, rebomOptions)
      let bomInput : BomInput = {
        bomInput: {
          rebomOptions: rebomOptions,
          bom: mergedBom,
        }
      }
      let bomRecord = await addBom(bomInput)
      return bomRecord
    } catch (e) {
      console.error("Error During merge", e)
      throw e
    }
  }

  async function findBomsForMerge(ids: string[], tldOnly: boolean) {
    let bomRecords = await BomRepository.bomsByIds(ids)
    let bomObjs: any[] = []
    if (bomRecords && bomRecords.length) {
      bomObjs = bomRecords.map(bomRecord => tldOnly ? extractTldFromBom(bomRecord.bom) : bomRecord.bom)
    }
    return bomObjs
  }



  function extractTldFromBom(bom: any) {
    let newBom: any = {}
    let rootComponentPurl: string
    try {
      // const bomAuthor = bom.metadata.tools.components[0].name
      // if (bomAuthor !== 'cdxgen') {
      //   console.error("Top level dependecy can be extracted only for cdxgen boms")
      //   throw new Error("Top level dependecy can be extracted only for cdxgen boms")

      // }
      rootComponentPurl = bom.metadata.component.purl
      if (!rootComponentPurl) {
        console.error("Need root component purl to be defined to extract top level dependencies")
        throw new Error("Need root component purl to be defined to extract top level dependencies")
      }
    } catch (e) {
      console.error(e)
      throw new Error("Top level dependecy can be extracted only for cdxgen boms")
    }
    let rootDepObj: any
    if (rootComponentPurl && bom.dependencies.length) {
      rootDepObj = bom.dependencies.find((dep: any) => dep.ref === rootComponentPurl)
      if (rootDepObj && rootDepObj.dependsOn.length && bom.components && bom.components.length) {
        newBom.components = bom.components.filter((comp: any) => rootDepObj.dependsOn.includes(comp.purl))
        newBom.dependencies = []
        newBom.dependencies[0] = rootDepObj
      }
    }
    const finalBom = Object.assign(bom, newBom)
    return finalBom
  }



  export async function mergeBomObjects(bomObjects: any[], rebomOptions: RebomOptions): Promise<any> {
    try {
      bomObjects.forEach(async (bobjs: any) => {
        await validateBom(bobjs)
      })
      
      
      const bomPaths: string[] = await utils.createTmpFiles(bomObjects)
      let command = ['merge']
      if(rebomOptions.structure.toUpperCase() ===  HIERARCHICHAL.toUpperCase()){
        command.push('--hierarchical')
      }
      command.push(
        '--output-format', 'json',
        '--input-format', 'json',
        '--group', rebomOptions.group,
        '--name', rebomOptions.name,
        '--version', rebomOptions.version,
        '--input-files', ...bomPaths
      )

      const mergeResponse: string = await utils.shellExec('cyclonedx-cli',command)
      // utils.deleteTmpFiles(bomPaths)s

      let jsonObj = JSON.parse(mergeResponse)
      jsonObj.metadata.tools = []
      let processedBom = await processBomObj(jsonObj)
      // let bomRoots = bomObjects.map(bomObj => bomObj.metadata.component)
      // use the bom roots to prep the root level dep obj if doesn't already exist!
      // check if the root level dep obj is there?
      let postMergeBom = postMergeOps(processedBom, rebomOptions)
      await validateBom(postMergeBom)
      return postMergeBom

    } catch (e) {
      console.error("Error During merge", e)
      throw e
    }

  }

  function postMergeOps(bomObj: any, rebomOptions: RebomOptions): any {
    // set bom-ref and purl for the root mreged component + we would need somekinda identifiers as well?
    let purl = generatePurl(rebomOptions)
    // bomObj.serialNumber = `urn:uuid:${rebomOptions.releaseId}`
    bomObj.metadata.component['bom-ref'] = purl
    bomObj.metadata.component['purl'] = purl
    addMissingDependecyGraph(bomObj, rebomOptions)
    return bomObj
  }

  function addMissingDependecyGraph(bomObj: any, dependencyMap: any){
    let deps = bomObj.dependencies
    // see if the dependencies graph has any info about root level
    // console.log('deps', deps)

  }

  function generatePurl(rebomOverride: RebomOptions): string {
    let purl = `pkg:reliza/${rebomOverride.group}/${rebomOverride.name}@${rebomOverride.version}` + (rebomOverride.rebomType ? `?rebomType=${rebomOverride.rebomType}` : '') + (rebomOverride.hash ? `&hash=${rebomOverride.hash}` : '') + (rebomOverride.tldOnly ? `&tldOnly=${rebomOverride.tldOnly}` : '') + (rebomOverride.structure.toLowerCase() === HIERARCHICHAL.toLowerCase() ? `&structure=${HIERARCHICHAL}` : '') 
    return purl
  }

  function rootComponentOverride(bom: any, rebomOverride: RebomOptions): any {
    // early return if no override
    if(!rebomOverride)
      return bom
    
    let newBom: any = {}
    let rootComponentPurl: string = decodeURIComponent(bom.metadata.component.purl)
    
    //generate purl
    let newPurl = generatePurl(rebomOverride)

    newBom.metadata = bom.metadata
    newBom.metadata.component.purl = newPurl
    newBom.metadata.component['bom-ref'] = newPurl
    newBom.metadata.component['name'] = rebomOverride.name 
    newBom.metadata.component['version'] = rebomOverride.version
    newBom.metadata.component['type'] = rebomOverride.rebomType?.toLowerCase() ?? 'application'
    newBom.metadata.component['group'] = rebomOverride.group

    newBom.dependencies = bom.dependencies

    let rootdepIndex = bom.dependencies.findIndex((dep: any) => dep.ref === rootComponentPurl)
    if(rootdepIndex > -1)
      newBom.dependencies[rootdepIndex]['ref'] = newPurl
    else
      console.error('root dependecy not found ! - rootComponentPurl:', rootComponentPurl ,' rebomOverride: ', rebomOverride, '\nserialNumber:', bom.serialNumber)
    const finalBom = Object.assign(bom, newBom)
    return finalBom
  }

  export async function addBom(bomInput: BomInput): Promise<BomRecord> {
    // preprocessing here
    let bomObj = await processBomObj(bomInput.bomInput.bom)
    bomObj = rootComponentOverride(bomObj, bomInput.bomInput.rebomOptions)

    let proceed: boolean = await validateBom(bomObj)
    let rebomOptions = bomInput.bomInput.rebomOptions ?? {}
    rebomOptions.serialNumber = bomObj.serialNumber
      
    if(process.env.OCI_STORAGE_ENABLED){
      bomObj = await pushToOci(rebomOptions.serialNumber, bomObj)
      console.log("push to oci rsp: ", bomObj)
      // bomObj = null
    }

    // urn must be unique - if same urn is supplied, we update current record
    // similarly it works for version, component group, component name, component version
    // check if urn is set on bom
    let queryText = 'INSERT INTO rebom.boms (meta, bom, tags) VALUES ($1, $2, $3) RETURNING *'
    let queryParams = [rebomOptions, bomObj, bomInput.bomInput.tags]
    if (rebomOptions.serialNumber) {
      let bomSearch: BomSearch = {
        bomSearch: {
          serialNumber: rebomOptions.serialNumber as string,
          version: '',
          componentVersion: '',
          componentGroup: '',
          componentName: '',
          singleQuery: '',
          page: 0,
          offset: 0
        }
      }
      // if bom record found then update, otherwise insert
      let bomRecord = await findBom(bomSearch)

      // if not found, re-try search by meta
      if (!bomRecord || !bomRecord.length)
        bomRecord = await findBomByMeta(rebomOptions)
      

      if (bomRecord && bomRecord.length && bomRecord[0].uuid) {
        queryText = 'UPDATE rebom.boms SET meta = $1, bom = $2, tags = $3 WHERE uuid = $4 RETURNING *'
        queryParams = [rebomOptions, bomObj, bomInput.bomInput.tags, bomRecord[0].uuid]
      }
    }

    let queryRes = await utils.runQuery(queryText, queryParams)
    return queryRes.rows[0]
  }



  async function processBomObj(bom: any): Promise<any> {
    let processedBom = {}

    processedBom = await sanitizeBom(bom, {
      '\\u003c': '<',
      '\\u003e': '>',
      '\\u0022': '',
      '\\u002B': '+',
      '\\u0027': ',',
      '\\u0060': '',
      'Purl': 'purl',
      ':git@github': ':ssh://git@github',
      'git+https://github': 'ssh://git@github',

    })
    // console.log("bom processed, validating ...")
    // console.log('processedBom data keys: ', Object.keys(processedBom))

    let proceed: boolean = await validateBom(processedBom)
    // const bomModel = new CDX.Models.Bom(bom) <- doesn't yet support deserialization

    if (proceed)
      processedBom = deduplicateBom(processedBom)

    proceed = await validateBom(processedBom)

    if (!proceed) {
      return null
    }

    return processedBom
  }

  function deduplicateBom(bom: any): any {
    let outBom: any = {
      'bomFormat': bom.bomFormat,
      'specVersion': bom.specVersion,
      'serialNumber': bom.serialNumber,
      'version': bom.version,
      'metadata': bom.metadata
    }
    let purl_dedup_map: any = {}
    let name_dedup_map: any = {}
    let out_components: any[] = []
    bom.components.forEach((component: any) => {
      if ('purl' in component) {
        if (!(component.purl in purl_dedup_map)) {
          out_components.push(component)
          purl_dedup_map[component.purl] = true
        } else {
          console.info(`deduped comp by purl: ${component.purl}`)
        }
      } else if ('name' in component && 'version' in component) {
        let nver: string = component.name + '_' + component.version
        if (!(nver in name_dedup_map)) {
          out_components.push(component)
          name_dedup_map[nver] = true
        } else {
          console.info(`deduped comp by name: ${nver}`)
        }
      } else {
        out_components.push(component)
      }
    })
    outBom.components = out_components
    if ('dependencies' in bom) {
      outBom.dependencies = bom.dependencies
    }

    console.info(`Dedup reduced json from ${Object.keys(bom).length} to ${Object.keys(outBom).length}`)
    return outBom
  }

  async function sanitizeBom(bom: any, patterns: Record<string, string>): Promise<any> {
    try {
      let jsonString = JSON.stringify(bom);
      // console.log('jsonstring', jsonString)
      Object.entries(patterns).forEach(([search, replace]) => {
        jsonString = jsonString.replaceAll(search, replace);
        // console.log('replaced', jsonString)
      });
      return JSON.parse(jsonString)
      // return bom
    } catch (e) {
      console.error("Error sanitizing bom", e)
      throw new Error("Error sanitizing bom: " + e);
    }
  }