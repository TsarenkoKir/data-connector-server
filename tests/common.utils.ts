const assert = require("assert")
import Axios from 'axios'
import { Context, Client } from '@verida/client-ts'
import { AutoAccount } from '@verida/account-node'

import serverconfig from '../src/config'
import { DatabasePermissionOptionsEnum, Network, IContext, IDatastore } from '@verida/types'
import { Connection, SyncProviderLogEntry, SyncProviderLogLevel } from '../src/interfaces'
import BaseSyncHandler from '../src/providers/BaseSyncHandler'

const SERVER_URL = serverconfig.serverUrl
const TEST_VAULT_PRIVATE_KEY = serverconfig.verida.testVeridaKey
const SCHEMA_DATA_CONNECTION = serverconfig.verida.schemas.DATA_CONNECTIONS
const DATA_SYNC_REQUEST_SCHEMA = serverconfig.verida.schemas.SYNC_REQUEST

const VERIDA_ENVIRONMENT = <Network> serverconfig.verida.environment
const DID_CLIENT_CONFIG = serverconfig.verida.didClientConfig

const axios = Axios.create()

export interface SyncSchemaConfig {
    limit?: number
    sinceId?: string
}

export interface NetworkInstance {
    did: string,
    network: Client,
    context: IContext,
    account: AutoAccount
}

let cachedNetworkInstance: NetworkInstance

const accountIdArg = process.argv.find(arg => arg.startsWith('--accountId='))
const cliAccountId = accountIdArg ? accountIdArg.split('=')[1] : undefined

export default class CommonUtils {

    static getNetwork = async (): Promise<NetworkInstance> => {
        if (cachedNetworkInstance) {
            return cachedNetworkInstance
        }

        const network = new Client({
            network: VERIDA_ENVIRONMENT
        })

        const account = new AutoAccount({
            privateKey: TEST_VAULT_PRIVATE_KEY,
            network: VERIDA_ENVIRONMENT,
            // @ts-ignore
            didClientConfig: DID_CLIENT_CONFIG
        })

        await network.connect(account);
        const context = <Context> await network.openContext('Verida: Vault')
        const did = await account.did()

        cachedNetworkInstance = {
            did,
            network,
            context,
            account
        }

        return cachedNetworkInstance
    }

    static getConnection = async(providerId: string, accountId?: string): Promise<Connection> => {
        if (!accountId) {
            accountId = cliAccountId
        }

        if (!cliAccountId) {
            console.log(`Account ID is not defined, using first account. Specify with --accountId=<accountId>`)
        }

        const { context } = await CommonUtils.getNetwork()
        const connectionsDs = await context.openDatastore(SCHEMA_DATA_CONNECTION)
        
        const filter = {
            providerId,
            accountId
        }

        const connection = <Connection | undefined> await connectionsDs.getOne(filter, {})

        if (!connection) {
            throw new Error(`Unable to locate connection: ${providerId} ${accountId}`)
        }

        return connection
    }

    static syncConnector = async (providerId: string, accessToken: string, refreshToken: string, did: string, encryptionKey: string, syncSchemas: Record<string, SyncSchemaConfig>): Promise<any> => {
        return await axios.post(`${SERVER_URL}/syncStart/${providerId}`, {
            accessToken,
            refreshToken,
            did,
            key: encryptionKey,
            syncSchemas
        })
    }

    static syncDone = async (providerId: string, did: string): Promise<any> => {
        return await axios.get(`${SERVER_URL}/syncDone/${providerId}`, {
            params: {
                did
            }
        })
    }

    static async openSchema(context: Context, contextName: string, schemaName: string, databaseName: string, encryptionKey: string, externalDid: string, did: string): Promise<any> {
        const externalDatastore = await context.openExternalDatastore(schemaName, externalDid, {
            permissions: {
                read: DatabasePermissionOptionsEnum.USERS,
                write: DatabasePermissionOptionsEnum.USERS,
                readList: [did],
                writeList: [did]
            },
            // @ts-ignore
            encryptionKey: Buffer.from(encryptionKey, 'hex'),
            databaseName,
            contextName
        })

        return externalDatastore
    }

    static getSyncResult = async (connection: any, syncRequestResult: any, encryptionKey: string) => {
        const { serverDid, contextName, syncRequestId, syncRequestDatabaseName } = syncRequestResult.data
            
        let syncResult
        let limit = 10
        while (limit > 0) {
            try {
                const syncRequest = await CommonUtils.openSchema(
                    connection.context,
                    contextName,
                    DATA_SYNC_REQUEST_SCHEMA,
                    syncRequestDatabaseName,
                    encryptionKey,
                    serverDid,
                    connection.did)
                syncResult = await syncRequest.get(syncRequestId)
                await CommonUtils.closeDatastore(syncRequest)

                if (syncResult.status == 'requested') {
                    continue
                }
                break
            } catch (err) {
                limit--
                await CommonUtils.sleep(1000)
            }
        }

        if (!syncResult) {
            throw new Error(`No sync result after 10 seconds`)
        } else {
            return syncResult
        }
    }

    static closeDatastore = async (datastore: IDatastore) => {
        await datastore.close({
            clearLocal: true
        })
    }

    static sleep = async (ms) => {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    static outputLogMessage(log: SyncProviderLogEntry) {
        console.log(
            `${log.level.toUpperCase()}: ${log.message} (${log.insertedAt})${
            log.schemaUri ? "-" + log.schemaUri : ""
            }`
        );
    }

    static setupHandlerLogging(handler: BaseSyncHandler, logLevel?: SyncProviderLogLevel) {
        if (logLevel) {
            console.log(`Setting log level: ${logLevel}`)
            handler.on('log', ((logEntry: SyncProviderLogEntry)=> {
              switch(logLevel) {
                case 'debug':
                  if (logEntry.level == SyncProviderLogLevel.DEBUG) {
                    CommonUtils.outputLogMessage(logEntry)
                  }
                case 'info':
                  if (logEntry.level == SyncProviderLogLevel.INFO) {
                    CommonUtils.outputLogMessage(logEntry)
                  }
                case 'error':
                  if (logEntry.level == SyncProviderLogLevel.ERROR) {
                    CommonUtils.outputLogMessage(logEntry)
                  }
              }
            }))
          } else {
            console.log(`Logging is disabled. Enable with --logLevel=debug|info|error`)
          }
    }
}