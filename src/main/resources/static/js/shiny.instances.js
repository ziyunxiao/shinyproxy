/*
 * ShinyProxy
 *
 * Copyright (C) 2016-2021 Open Analytics
 *
 * ===========================================================================
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the Apache License as published by
 * The Apache Software Foundation, either version 2 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * Apache License for more details.
 *
 * You should have received a copy of the Apache License
 * along with this program.  If not, see <http://www.apache.org/licenses/>
 */
Shiny = window.Shiny || {};
Shiny.instances = {

    _template: null,
    _nameRegex: new RegExp('^[a-zA-Z0-9_.-]*$'),
    _refreshIntervalId: null,

    eventHandlers: {
        onShow: function () {
            Shiny.instances._refreshModal();
            clearInterval(Shiny.instances._refreshIntervalId);
            Shiny.instances._refreshIntervalId = setInterval(async function () {
                if (!document.hidden) {
                    await Shiny.instances._refreshModal();
                }
            }, 2500);
        },
        onClose: function () {
            clearInterval(Shiny.instances._refreshIntervalId);
        },
        onDeleteInstance: async function (appInstanceName, proxyId, spInstance) {
            if (appInstanceName === undefined) {
                // when no arguments provided -> stop the current app
                appInstanceName = Shiny.instances._toAppDisplayName(Shiny.app.staticState.appInstanceName);
                proxyId = Shiny.app.staticState.proxyId;
                spInstance = Shiny.app.staticState.spInstance;
            }

            if (confirm("Are you sure you want to stop instance \"" + appInstanceName + "\"?")) {
                await Shiny.instances._deleteInstance(proxyId, spInstance);
                if (proxyId === Shiny.app.staticState.proxyId) {
                    Shiny.ui.showStoppedPage();
                }
            }
        },
        onRestartInstance: async function () {
            if (confirm("Are you sure you want to restart the current instance?")) {
                Shiny.ui.hideInstanceModal();
                Shiny.ui.showLoading();

                if (Shiny.app.runtimeState.appStopped) {
                    window.location.reload(false);
                    return;
                }

                await Shiny.instances._deleteInstance(Shiny.app.staticState.proxyId, Shiny.app.staticState.spInstance);
                await Shiny.instances._waitUntilInstanceDeleted(Shiny.app.staticState.proxyId, Shiny.app.staticState.spInstance);
                window.location.reload(false);
            }
        },
        onNewInstance: function () {
            var inputField = $("#instanceNameField");
            var instance = inputField.val().trim();

            if (instance === "") {
                return;
            }

            if (instance.length > 64) {
                alert("The provided name is too long (maximum 64 characters)");
                return;
            }

            if (!Shiny.instances._nameRegex.test(instance)) {
                alert("The provided name contains invalid characters (only alphanumeric characters, '_', '-' and '.' are allowed.)");
                return;
            }

            if (instance === Shiny.app.staticState.appInstanceName) {
                alert("This instance is already opened in the current tab");
                return;
            }

            if (Shiny.app.staticState.maxInstances !== -1) {
                // this must be a synchronous call (i.e. without any callbacks) so that the window.open function is not
                // blocked by the browser.
                var currentAmountOfInstances = Shiny.instances._getCurrentAmountOfInstances();
                if (currentAmountOfInstances >= Shiny.app.staticState.maxInstances) {
                    alert("You cannot start a new instance because you are using the maximum amount of instances of this app!");
                    return;
                }
            }

            window.open(Shiny.instances._createUrlForInstance(instance), "_blank");
            inputField.val('');
            Shiny.ui.hideInstanceModal();

        },
    },

    _createUrlForInstance: function (instance) {
        return Shiny.common.staticState.contextPath + "app_i/" + Shiny.app.staticState.appName + "/" + instance + "/";
    },

    _deleteInstance: async function (proxyId, spInstance) {
        if (proxyId === Shiny.app.staticState.proxyId) {
            Shiny.app.runtimeState.appStopped = true;
            Shiny.ui.removeFrame();
        }
        try {
            await Shiny.api.deleteProxyById(proxyId, spInstance);
        } catch (e) {
            alert("Error stopping proxy, please try again.")
        }
    },

    _waitUntilInstanceDeleted: async function (proxyId, spInstance) {
        while (await Shiny.api.getProxyById(proxyId, spInstance) != null) {
            await Shiny.common.sleep(500);
        }
    },
    _refreshModal: async function () {
        const proxies = await Shiny.api.getProxiesOnAllSpInstances();
        let templateData = {'instances': []};

        for (const proxy of proxies) {
            if (proxy.hasOwnProperty('spec') && proxy.spec.hasOwnProperty('id') &&
                proxy.hasOwnProperty('runtimeValues') &&
                proxy.runtimeValues.hasOwnProperty('SHINYPROXY_APP_INSTANCE') &&
                proxy.runtimeValues.hasOwnProperty('SHINYPROXY_INSTANCE')
            ) {

                let appInstance = proxy.runtimeValues.SHINYPROXY_APP_INSTANCE;
                if (proxy.spec.id !== Shiny.app.staticState.appName) {
                    continue;
                }

                if (proxy.status !== "Up" && proxy.status !== "Starting" && proxy.status !== "New") {
                    continue;
                }

                let proxyName = ""
                if (appInstance === "_") {
                    proxyName = "Default";
                } else {
                    proxyName = appInstance;
                }

                let uptime = "N/A";
                if (proxy.hasOwnProperty("startupTimestamp") && proxy.startupTimestamp > 0) {
                    const uptimeSec = (Date.now() - proxy.startupTimestamp) / 1000;
                    const hours = Math.floor(uptimeSec / 3600);
                    const minutes = Math.floor((uptimeSec % 3600) / 60).toString().padStart(2, '0');
                    const seconds = Math.floor(uptimeSec % 60).toString().padStart(2, '0');
                    uptime = `${hours}:${minutes}:${seconds}`
                }

                const active = Shiny.app.staticState.proxyId === proxy.id; // TODO startup
                const url = Shiny.instances._createUrlForProxy(proxy);

                templateData['instances'].push({
                    name: proxyName,
                    active: active,
                    url: url,
                    spInstance: proxy.runtimeValues.SHINYPROXY_INSTANCE,
                    proxyId: proxy.id,
                    uptime: uptime
                });
            } else {
                console.log("Received invalid proxy object from server.");
            }
        }

        templateData['instances'].sort(function (a, b) {
            return a.name.toLowerCase() > b.name.toLowerCase() ? 1 : -1
        });

        if (Shiny.app.staticState.maxInstances === -1) {
            $('#maxInstances').text("unlimited");
        } else {
            $('#maxInstances').text(Shiny.app.staticState.maxInstances);
        }
        $('#usedInstances').text(templateData['instances'].length); // TODO
        document.getElementById('appInstances').innerHTML = Shiny.instances._template(templateData);
    },
    _createUrlForProxy: function (proxy) {
        const appName = proxy.spec.id;
        const appInstance = proxy.runtimeValues.SHINYPROXY_APP_INSTANCE;
        const appSpInstance = proxy.runtimeValues.SHINYPROXY_INSTANCE;
        if (appSpInstance !== Shiny.app.staticState.spInstance) {
            return Shiny.common.staticState.contextPath + "app_i/" + appName + "/" + appInstance + "/?sp_instance_override=" + appSpInstance;
        } else {
            return Shiny.common.staticState.contextPath + "app_i/" + appName + "/" + appInstance + "/";
        }
    },
    _getCurrentAmountOfInstances: function () {
        var currentAmountOfInstances = 0;

        // TODO current instance
        // TODO owned only
        $.ajax({
            url: Shiny.api.buildURL("api/proxy?only_owned_proxies=true", false),
            success: function (result) {
                for (var idx = 0; idx < result.length; idx++) {
                    var proxy = result[idx];
                    if (proxy.hasOwnProperty('spec') && proxy.spec.hasOwnProperty('id') && proxy.spec.id === Shiny.app.staticState.appName) {
                        currentAmountOfInstances++;
                    }
                }
            },
            async: false
        });

        return currentAmountOfInstances;
    },
    _toAppDisplayName(appInstanceName) {
        if (appInstanceName === "_") {
            return "Default";
        }
        return appInstanceName;
    }
};