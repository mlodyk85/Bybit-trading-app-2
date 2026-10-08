const { withAndroidManifest } = require('@expo/config-plugins');

module.exports = function withBackgroundActions(config) {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults;
    const application = manifest.manifest.application?.[0];
    if (!application) return config;

    application.service = application.service || [];
    const serviceName = 'com.asterinet.react.bgactions.RNBackgroundActionsTask';
    let service = application.service.find(
      (item) => item?.$?.['android:name'] === serviceName || item?.$?.['android:name'] === '.RNBackgroundActionsTask'
    );

    if (!service) {
      service = { $: { 'android:name': serviceName } };
      application.service.push(service);
    }

    service.$ = service.$ || {};
    service.$['android:name'] = serviceName;
    service.$['android:foregroundServiceType'] = 'dataSync';
    service.$['android:exported'] = 'false';

    return config;
  });
};
