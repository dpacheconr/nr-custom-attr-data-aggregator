const TASKS = [{
    "id":"uniqExperiements",
    "name":"Unique Experiements",
    "accountId":"3491187",
    "selector":"experiments",
    "delimiter": ",",
    "assignment": "=",
    "query":"SELECT uniques(experiments,10000) as experiments from Experiment since 1 day ago"
}
,
{
    "id":"uniqFoods",
    "name":"Unique Foods",
    "accountId":"3491187",
    "selector":"food",
    "delimiter": "|",
    "assignment": ":",
    "query":"SELECT uniques(food,10000) as food from SomeThing since 1 day ago"
}
]

// Configurations
const NAMESPACE = "dashFilterData";         // event details are prefixed with this, best to leave as is
const NEWRELIC_DC = "US"                    // datacenter for account - US or EU
const ACCOUNT_ID = "3491187"                // Account ID (required if ingesting events)
let INSERT_KEY = $secure ? $secure.YOUR_INGEST_KEY_CRED_NAME : null     // Ingest key, stored in secure credential
let QUERY_KEY =  $secure ? $secure.YOUR_QUERY_KEY_CRED_NAME  : null     // User query key, stored in secure credential


// Other config, shouldnt need changing
const VERBOSE_LOG=true          // Control how much logging there is
const DEFAULT_TIMEOUT = 5000    // You can specify a timeout for each task
const INGEST_EVENT_ENDPOINT = NEWRELIC_DC === "EU" ? "insights-collector.eu01.nr-data.net" : "insights-collector.newrelic.com" 
const GRAPHQL_ENDPOINT = NEWRELIC_DC === "EU" ? "api.eu.newrelic.com" : "api.newrelic.com" 
const INGEST_EVENT_TYPE=`${NAMESPACE}` //events are stored in the eventtype

let assert = require('assert');
let _ = require("lodash");
let RUNNING_LOCALLY = false


/*
*  ========== LOCAL TESTING CONFIGURATION ===========================
*  This section allows you to run the script from your local machine
*  mimicking it running in the new relic environment. Much easier to develop!
*/

const IS_LOCAL_ENV = typeof $http === 'undefined';
if (IS_LOCAL_ENV) {  
  RUNNING_LOCALLY=true
  var $http = require("request");       //only for local development testing
  var $secure = {}                      //only for local development testing
  QUERY_KEY=process.env['NR_QUERY_KEY']  //NRAK... or from env var
  INSERT_KEY=process.env["NR_INGEST_KEY"]  //...NRAL

  console.log("Running in local mode",true)
} 

/*
*  ========== SOME HELPER FUNCTIONS ===========================
*/


/*
* log()
*
* A logger, that logs only if verbosity is enabled
*
* @param {string|object} data - the data to log out
* @param {bool} verbose - if true overrides global setting
*/
const log = function(data, verbose) {
    if(VERBOSE_LOG || verbose) { console.log(data) }
}

/*
* asyncForEach()
*
* A handy version of forEach that supports await.
* @param {Object[]} array     - An array of things to iterate over
* @param {function} callback  - The callback for each item
*/
async function asyncForEach(array, callback) {
    for (let index = 0; index < array.length; index++) {
        await callback(array[index], index, array);
    }
}
  
/*
* isObject()
*
* A handy check for if a var is an object
*/
function isObject(val) {
    if (val === null) { return false;}
    return ( (typeof val === 'function') || (typeof val === 'object') );
}

/*
* sendEventDataToNewRelic()
* Sends a event payload to New Relic
*
* @param {object} data               - the payload to send
*/
const sendEventDataToNewRelic = async (data) =>  {
    let request = {
        url: `https://${INGEST_EVENT_ENDPOINT}/v1/accounts/${ACCOUNT_ID}/events`,
        method: 'POST',
        headers :{
            "Api-Key": INSERT_KEY
        },
        body: JSON.stringify(data)
    }
    log(`\nSending ${data.length} records to NR events API...`)
    return genericServiceCall([200,202],request,(body,response,error)=>{
        if(error) {
            log(`NR Post failed : ${error} `,true)
            return false
        } else {
            return true
        }
    })
}

/*
* genericServiceCall()
* Generic service call helper for commonly repeated tasks
*
* @param {number} responseCodes  - The response code (or array of codes) expected from the api call (e.g. 200 or [200,201])
* @param {Object} options       - The standard http request options object
* @param {function} success     - Call back function to run on successfule request
*/
const  genericServiceCall = function(responseCodes,options,success) {
    !('timeout' in options) && (options.timeout = DEFAULT_TIMEOUT) //add a timeout if not already specified 
    let possibleResponseCodes=responseCodes
    if(typeof(responseCodes) == 'number') { //convert to array if not supplied as array
      possibleResponseCodes=[responseCodes]
    }
    return new Promise((resolve, reject) => {
        $http(options, function callback(error, response, body) {
        if(error) {
            console.log("Request error:",error)
            console.log("Response:",response)
            console.log("Body:",body)
            reject(`Connection error on url '${options.url}'`)
        } else {
            if(!possibleResponseCodes.includes(response.statusCode)) {
                let errmsg=`Expected [${possibleResponseCodes}] response code but got '${response.statusCode}' from url '${options.url}'`
                reject(errmsg)
            } else {
                resolve(success(body,response,error))
            }
          }
        });
    })
  }

/*
* setAttribute()
* Sets a custom attribute on the synthetic record
*
* @param {string} key               - the key name
* @param {Strin|Object} value       - the value to set
*/
const setAttribute = function(key,value) {
    if(!RUNNING_LOCALLY) { //these only make sense when running on a minion
        $util.insights.set(key,value)
    } else {
        //log(`Set attribute '${key}' to ${value}`)
    }
}

async function runtasks(tasks) {
    let TOTALREQUESTS=0,SUCCESSFUL_REQUESTS=0,FAILED_REQUESTS=0
    let FAILURE_DETAIL = []
    let eventsInnerPayload=[]
    await asyncForEach(tasks, async (task) => {


        const graphQLQuery=`{
            actor {
              account(id: ${task.accountId}) {
                nrql(query: "${task.query}") {
                  results
                  metadata {
                    facets
                  }
                }
              }
            }
          }
          `
        const options =  {
                url: `https://${GRAPHQL_ENDPOINT}/graphql`,
                method: 'POST',
                headers :{
                  "Content-Type": "application/json",
                  "API-Key": QUERY_KEY
                },
                body: JSON.stringify({ "query": graphQLQuery})
            }
    
        TOTALREQUESTS++
        log(`\n[Task ${task.id}]---------------`)
        await genericServiceCall([200],options,(body)=>{return body})
        .then((body)=>{
            try {
                let bodyJSON
                if(isObject(body)) {
                    bodyJSON = body
                } else {
                    bodyJSON = JSON.parse(body)
                }  
       
       
                let resultData={}
                let result=null

                resultData=bodyJSON.data.actor.account.nrql.results
                let elements = []
                // Gather the data from all the results into one list
                resultData.forEach(element => {
                    const array = element[String(task.selector)];
                    array.forEach(el => {
                            elements=elements.concat(el.split(task.delimiter));
                    })
                })

                result=Array.from(new Set(elements)); //reduce to unique values


            if(result!==undefined) {
                SUCCESSFUL_REQUESTS++
                log(`Task succeeded generating ${result.length} values:`)
                log(result)

                const constructPayload = (result) =>{
                    let attributes={}
                    const timeNow=Math.round(Date.now()/1000);

                    attributes[`${NAMESPACE}.id`]=task.id
                    attributes[`${NAMESPACE}.name`]=task.name

                    result.forEach(element => {
                            field = element.split(task.assignment);
                            let eventPayload = {
                                eventType: INGEST_EVENT_TYPE,
                                field: field[0],
                                value: field[1],
                                generated: timeNow
                            }
                            eventPayload=Object.assign(eventPayload, attributes)
                            eventsInnerPayload.push(eventPayload)
                        });
                }
                constructPayload(result)

            } else {
                FAILED_REQUESTS++
                log(`Task '${task.name}' failed, no field returned by selector '${task.selector}' in json:  ${JSON.stringify(resultData)}`)
            }

            } catch(e){
                FAILED_REQUESTS++
                log(`Task '${task.name}' failed JSON parse error: ${e} `,true)
                FAILURE_DETAIL.push(`'${task.name}' failed JSON parse: ${e} `)
            }
          
        })
        .catch((e)=>{
            FAILED_REQUESTS++
            log(`Task '${task.name}' failed with error: ${e} `,true)
            FAILURE_DETAIL.push(`'${task.name}' failed with error: ${e} `)
        })
    })

    let NRPostStatus = await sendEventDataToNewRelic(eventsInnerPayload)
    if( NRPostStatus === true ){
        setAttribute("nrPostEventStatus","success")
        log("NR Events Post successful")   
    } else {
        setAttribute("nrPostEventStatus","failed")
        log("NR Events Post failed")   
    }

    log(`\n\n-----\nAttempted: ${TOTALREQUESTS}, Succeded ${SUCCESSFUL_REQUESTS}, Failed: ${FAILED_REQUESTS}`,true)
    
    //record the statistics about the success rates as custom attributes on the SyntheticCheck event type
    setAttribute("tasksAttempted",TOTALREQUESTS)
    setAttribute("tasksSucceeded",SUCCESSFUL_REQUESTS)
    setAttribute("tasksFailed",FAILED_REQUESTS)
    setAttribute("tasksSuccessRate",((SUCCESSFUL_REQUESTS/TOTALREQUESTS)*100).toFixed(2))
    setAttribute("failureDetail",FAILURE_DETAIL.join("; "))
    return FAILED_REQUESTS
}


/*
*  ========== RUN THE tasks ===========================
*/


try {
    setAttribute("totalTasksConfigured",TASKS.length)
    runtasks(TASKS).then((failed)=>{
        setAttribute("testRunComplete","YES") //to ensure we've not timed out or broken somehow
        if(failed > 0 ) {
            setAttribute("taskResult","FAILED")
            assert.fail('Not all tasks passed or ingest post failed') //assert a failure so that NR sees it as a failed test
        } else {
            setAttribute("taskResult","SUCCESS")
            assert.ok("All tasks passed")   
        }
    })

} catch(e) {
    console.log("Unexpected errors: ",e)
}