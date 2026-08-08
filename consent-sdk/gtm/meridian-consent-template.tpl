___TERMS_OF_SERVICE___

By creating or modifying this file you agree to Google Tag Manager's Community
Template Gallery Developer Terms of Service available at
https://developers.google.com/tag-manager/gallery-tos (or such other URL as
Google may provide), as modified from time to time.

___INFO___

{
  "type": "TAG",
  "id": "cvt_meridian_consent",
  "version": 1,
  "displayName": "Meridian Consent Bridge",
  "categories": ["UTILITY", "ANALYTICS", "ADVERTISING"],
  "brand": {"id": "meridian", "displayName": "Meridian"},
  "description": "Applies Meridian Consent's stored or dataLayer consent state through GTM's native Consent APIs.",
  "containerContexts": ["WEB"]
}

___TEMPLATE_PARAMETERS___

[
  {
    "type": "SELECT",
    "name": "command",
    "displayName": "Consent command",
    "selectItems": [
      {"value": "default", "displayValue": "Default: read meridian_consent cookie"},
      {"value": "update", "displayValue": "Update: read Meridian Consent dataLayer object"}
    ],
    "simpleValueType": true,
    "defaultValue": "default",
    "alwaysInSummary": true
  },
  {
    "type": "TEXT",
    "name": "policyVersion",
    "displayName": "Policy version",
    "simpleValueType": true,
    "defaultValue": "1.0",
    "alwaysInSummary": true,
    "valueValidators": [{"type": "NON_EMPTY"}]
  },
  {
    "type": "TEXT",
    "name": "waitForUpdate",
    "displayName": "Wait for update",
    "simpleValueType": true,
    "defaultValue": 500,
    "valueUnit": "milliseconds",
    "enablingConditions": [{"paramName": "command", "paramValue": "default", "type": "EQUALS"}],
    "valueValidators": [{"type": "NON_NEGATIVE_NUMBER"}]
  }
]

___SANDBOXED_JS_FOR_WEB_TEMPLATE___

const JSON = require('JSON');
const copyFromDataLayer = require('copyFromDataLayer');
const decodeUriComponent = require('decodeUriComponent');
const getCookieValues = require('getCookieValues');
const makeNumber = require('makeNumber');
const setDefaultConsentState = require('setDefaultConsentState');
const updateConsentState = require('updateConsentState');

const types = [
  'security_storage',
  'functionality_storage',
  'personalization_storage',
  'analytics_storage',
  'ad_storage',
  'ad_user_data',
  'ad_personalization'
];

const normalize = input => {
  const output = {};
  types.forEach(type => {
    output[type] = type === 'security_storage' || (input && input[type] === 'granted') ? 'granted' : 'denied';
  });
  return output;
};

if (data.command === 'update') {
  const update = copyFromDataLayer('meridian_consent', 2) || {};
  updateConsentState(normalize(update));
  data.gtmOnSuccess();
  return;
}

const values = getCookieValues('meridian_consent', false);
let stored = {};
if (values && values.length) {
  try {
    const parsed = JSON.parse(decodeUriComponent(values[0]));
    stored = parsed && parsed.schema_version === '1.0' && parsed.policy_version === data.policyVersion && parsed.states ? parsed.states : {};
  } catch (error) {
    stored = {};
  }
}
const defaults = normalize(stored);
defaults.wait_for_update = makeNumber(data.waitForUpdate) || 500;
setDefaultConsentState(defaults);
data.gtmOnSuccess();

___WEB_PERMISSIONS___

[
  {
    "instance": {
      "key": {"publicId": "get_cookies", "versionId": "1"},
      "param": [
        {"key": "cookieAccess", "value": {"type": 1, "string": "specific"}},
        {"key": "cookieNames", "value": {"type": 2, "listItem": [{"type": 1, "string": "meridian_consent"}]}}
      ]
    },
    "clientAnnotations": {"isEditedByUser": true},
    "isRequired": true
  },
  {
    "instance": {
      "key": {"publicId": "read_data_layer", "versionId": "1"},
      "param": [{"key": "keyPatterns", "value": {"type": 2, "listItem": [{"type": 1, "string": "meridian_consent"}]}}]
    },
    "clientAnnotations": {"isEditedByUser": true},
    "isRequired": true
  },
  {
    "instance": {
      "key": {"publicId": "access_consent", "versionId": "1"},
      "param": [{
        "key": "consentTypes",
        "value": {"type": 2, "listItem": [
          {"type": 3, "mapKey": [{"type": 1, "string": "consentType"},{"type": 1, "string": "read"},{"type": 1, "string": "write"}], "mapValue": [{"type": 1, "string": "security_storage"},{"type": 8, "boolean": true},{"type": 8, "boolean": true}]},
          {"type": 3, "mapKey": [{"type": 1, "string": "consentType"},{"type": 1, "string": "read"},{"type": 1, "string": "write"}], "mapValue": [{"type": 1, "string": "functionality_storage"},{"type": 8, "boolean": true},{"type": 8, "boolean": true}]},
          {"type": 3, "mapKey": [{"type": 1, "string": "consentType"},{"type": 1, "string": "read"},{"type": 1, "string": "write"}], "mapValue": [{"type": 1, "string": "personalization_storage"},{"type": 8, "boolean": true},{"type": 8, "boolean": true}]},
          {"type": 3, "mapKey": [{"type": 1, "string": "consentType"},{"type": 1, "string": "read"},{"type": 1, "string": "write"}], "mapValue": [{"type": 1, "string": "analytics_storage"},{"type": 8, "boolean": true},{"type": 8, "boolean": true}]},
          {"type": 3, "mapKey": [{"type": 1, "string": "consentType"},{"type": 1, "string": "read"},{"type": 1, "string": "write"}], "mapValue": [{"type": 1, "string": "ad_storage"},{"type": 8, "boolean": true},{"type": 8, "boolean": true}]},
          {"type": 3, "mapKey": [{"type": 1, "string": "consentType"},{"type": 1, "string": "read"},{"type": 1, "string": "write"}], "mapValue": [{"type": 1, "string": "ad_user_data"},{"type": 8, "boolean": true},{"type": 8, "boolean": true}]},
          {"type": 3, "mapKey": [{"type": 1, "string": "consentType"},{"type": 1, "string": "read"},{"type": 1, "string": "write"}], "mapValue": [{"type": 1, "string": "ad_personalization"},{"type": 8, "boolean": true},{"type": 8, "boolean": true}]}
        ]}
      }]
    },
    "clientAnnotations": {"isEditedByUser": true},
    "isRequired": true
  }
]

___TESTS___

scenarios:
- name: defaults are denied without a saved choice
  code: |-
    mock('getCookieValues', () => []);
    runCode(mockData);
    assertApi('setDefaultConsentState').wasCalledWith({
      security_storage: 'granted',
      functionality_storage: 'denied',
      personalization_storage: 'denied',
      analytics_storage: 'denied',
      ad_storage: 'denied',
      ad_user_data: 'denied',
      ad_personalization: 'denied',
      wait_for_update: 500
    });
    assertApi('gtmOnSuccess').wasCalled();
- name: update reads the stable dataLayer contract
  code: |-
    mockData.command = 'update';
    mock('copyFromDataLayer', () => ({analytics_storage: 'granted', security_storage: 'granted'}));
    runCode(mockData);
    assertApi('updateConsentState').wasCalledWith({
      security_storage: 'granted',
      functionality_storage: 'denied',
      personalization_storage: 'denied',
      analytics_storage: 'granted',
      ad_storage: 'denied',
      ad_user_data: 'denied',
      ad_personalization: 'denied'
    });
    assertApi('gtmOnSuccess').wasCalled();
setup: |-
  const mockData = {command: 'default', policyVersion: '1.0', waitForUpdate: 500};

___NOTES___

Meridian Consent Bridge 0.1.0. Run the default tag on Consent Initialization
and the update tag on meridian_consent_updated.
