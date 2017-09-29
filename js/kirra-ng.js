var kirraApplicationUri;
var kirraApplicationPath;
var kirraUIMappings;
var kirraAppLabels;
var kirraBasePath;

var kirraDefaultAppLabels = {
        
    'dashboard': {
        'view_details': 'View details'
    },
    'user': {
        'log_in': "Log in",
        'log_out': "Log out",
        'sign_up': "Sign up",
        'already_a_user': "Already a user?",
        'click_to_log_in': "Click here to log in",
        'please_sign_in': "Please sign in",
        'register_as': "Register as {entityName}",
        'user': "User"
    },
    'all': "All",
    'load_more_data': "More...",
    'loading_data_for': "Loading data for {entityName}...",
    'no_data_found': "No data found",
    'start_typing': "Start typing...",
    'actions': "Actions",
    'adding': "Adding",
    'apply': "Apply",
    'edit': "Edit",
    'editing': "Editing",
    'delete': "Delete",
    'child_edit': "Edit {relationshipName}",
    'child_delete': "Delete {relationshipName}",
    'cancel': "Cancel",
    'create': "Create",
    'craeting': "Creating",
    'save': "Save",
    'download_attachment': "Download",
    'delete_attachment': "Delete",
    'show_attachment': "Show",
    'upload_attachment': "Upload",
    'cancel_attachment': "Cancel",
    
}

kirraAppLabels = kirraAppLabels || kirraDefaultAppLabels;
kirraUIMappings = kirraUIMappings || [];
kirraBasePath = kirraBasePath || "";


var uriMatches = window.location.search.match("[?&]?app-uri\=([^&]+)");
var pathMatches = window.location.search.match("[?&]?app-path\=([^&]+)");
var themeMatches = window.location.search.match("[?&]?theme\=([^&]*)")

if (!uriMatches && !pathMatches && !kirraApplicationUri && !kirraApplicationPath) {
     throw Error("You must specify an application URI or path (same server) using the app-uri or app-path query parameters, like '...?app-uri=http://myserver.com/myapp/rest/' or '...?app-path=/myapp/rest/'.");
}

var applicationUrl = kirraApplicationUri || (
        uriMatches ? uriMatches[1] : (
            window.location.origin + (kirraApplicationPath || pathMatches[1])
        )
    );
if (!applicationUrl.endsWith('/')) applicationUrl = applicationUrl + '/';

var changeTheme = function(theme) {
    var themeElement = document.getElementById('bootstrap_theme');
    var newThemeURI = 'https://maxcdn.bootstrapcdn.com/bootswatch/3.3.7/' + theme + '/bootstrap.min.css';
    document.getElementById('bootstrap_theme').href = newThemeURI;
};

var canChangeTheme = themeMatches;

if (canChangeTheme && themeMatches[1]) {
    var theme = themeMatches[1];
    changeTheme(theme); 
}

var repository = kirra.newRepository(applicationUrl);

var kirraNG = {};

var application;
var entities;
var entitiesByName;
var entityCapabilitiesByName;
var entityNames;
var kirraModule;
var encodedCredentials = undefined;
var kirraDefaultPageSize;
kirraDefaultPageSize = kirraDefaultPageSize || 10;

var kirraLoadLazyScripts = function() {
    console.log("Loading lazy scripts");
    var x = document.getElementsByTagName('script')[0];
    angular.forEach(document.getElementsByTagName("lazy-script"), function(element) {
        console.log("Loading " + element.getAttribute("src"));
        var s = document.createElement('script');
        s.type = 'text/javascript';
        s.src = element.getAttribute("src");
        x.parentNode.appendChild(s);
    });
    console.log("Loaded lazy scripts");
}

var kirraCheckRoles = function(object, roles) {
    if (object['_roles'] && roles) {
        var match = kirraNG.intersect(roles, object['_roles']).length > 0;
        return match;       
    }
    return true;
};

var kirraGetCustomSettings = function(viewName, hierarchy, itemName, roles, extractorFn) {
    var mappingsForRole = kirraNG.find(kirraUIMappings, function(it) {
        return kirraCheckRoles(it, roles);        
    });
    if (!mappingsForRole) {
        return undefined;
    }
    var mappingsForEntity = [hierarchy && mappingsForRole[hierarchy[0]], mappingsForRole['_global']];
    var searchFn = function (it) {
        var match = it && kirraCheckRoles(it, roles) && it[itemName]; 
        return match;
    };
    
    var found = kirraNG.find(mappingsForEntity, searchFn);
    if (found && found[itemName]) {
        return extractorFn ? extractorFn(found[itemName]) : found[itemName];
    }
    return undefined;
};

var kirraGetDefaultTemplateUrl = function(viewName) {
    return 'templates/' + viewName + '.html';
};

var kirraGetTemplateUrl = function(viewName, hierarchy, roles) {
    var found = kirraGetCustomSettings('', hierarchy, 'views', roles, function(views) {
        return views[viewName] && views[viewName].template;
    });
    var actual = found ? found : kirraGetDefaultTemplateUrl(viewName);
    return kirraBasePath + actual;
};

var kirraReload = function(url) {
    window.location.href = url || application.viewUri;
    //window.location.reload();  
};

var kirraMapCustomSlot = function(entity, actual) {
    var slotName, mappingFn;
    if (typeof actual === "object") {
        slotName = actual.slot;
        mappingFn = actual.mappingFn;
    } else if (typeof actual === "string") {
        slotName = actual;
    } else {
        throw Error("Unexpected value for actual slot: " + actual);
    }
    
    var asProperty = entity.properties[slotName];
    var asRelationship = entity.relationships[slotName];
    var slot = angular.copy(asProperty || asRelationship);
    if (slot === undefined) {
        throw Error("No slot found with name: " + slotName + " in " + entity.fullName);
    }
    slot.mappingFn = mappingFn;
    return slot;
};

var kirraGetCustomSlots = function(viewName, entity) {
    var slotMapping = kirraGetCustomSettings(viewName, [entity.fullName], 'slotMapping');
    var result = {};
    if (slotMapping) {
        angular.forEach(slotMapping, function(actual, expected) {
            result[expected] = kirraMapCustomSlot(entity, actual);
        });
    }
    return result;
};

var kirraGetCustomEntities = function(viewName, entity) {
    var entityMappings = kirraGetCustomSettings(viewName, [entity.fullName], 'entities');
    return entities || {};
};


var kirraGetCustomEdges = function(viewName, entity) {
    var edgeMapping = kirraGetCustomSettings(viewName, [entity.fullName], 'edgeMapping');
    var result = {};
    if (edgeMapping) {
        angular.forEach(edgeMapping, function(edgeMappingDetails, expectedEdgeName) {
            var actualEdgeName = edgeMappingDetails.relationship;       
            var relationship = entity.relationships[actualEdgeName];
            if (!relationship) {
                console.error("Unknown relationship " + entity.fullName + '.' + actualEdgeName);
                return;
            }
            var relatedEntity = entitiesByName[relationship.typeRef.fullName];
            var edgeSlots = {};
            var slotMapping = edgeMappingDetails.slotMapping;
            if (slotMapping) {
                angular.forEach(slotMapping, function(actual, expected) {
                    edgeSlots[expected] = kirraMapCustomSlot(relatedEntity, actual);
                });
            }
            var actions = edgeMappingDetails.actions;
            var edgeActions = {};
            if (actions) {
                angular.forEach(actions, function(actualActionName, expectedActionName) {
                    var operation = relatedEntity.operations[actualActionName];
                    if (operation.kind == "Action" && operation.instanceOperation) {
                        edgeActions[expectedActionName] = operation;
                    }
                });
            }
            result[expectedEdgeName] = {
                relationship: relationship,
                slots: edgeSlots,
                edgeActions: edgeActions,
                name: expectedEdgeName
            };
        });
    }
    return result;
};


var kirraBuildCustomMetadata = function(viewName, entity) {
    var customMetadata = {
        slots: kirraGetCustomSlots(viewName, entity),
        edges: kirraGetCustomEdges(viewName, entity),
        entities: kirraGetCustomEntities(viewName, entity),
        instanceActions: kirraGetCustomInstanceActions(viewName, entity),
        queries: kirraGetCustomQueries(viewName, entity),
    }
    customMetadata.dataLoader = kirraGetCustomViewData(entity, customMetadata.slots, customMetadata.instanceActions);
    customMetadata.computeState = function(canonicalStateName) {
        var components = canonicalStateName.split(/[.:]/);
        var actualEntity = customMetadata.entities[components[0]];
        var localStateName = components[1];
        var customStateName = kirraNG.toState(actualEntity, localStateName)
        return customStateName;    
    };
    return customMetadata;
};

var kirraGetCustomInstanceActions = function(viewName, entity) {
    var actions = kirraGetCustomSettings(viewName, [entity.fullName], 'actions');
    var result = {};
    if (actions) {
        angular.forEach(actions, function(actualActionName, expectedActionName) {
            var operation = entity.operations[actualActionName];
            if (operation == undefined) {
                console.error("Unknown operation for mapping: " + actualActionName + " -> " + expectedActionName);
                return;
            }
            if (operation.kind == "Action" && operation.instanceOperation) {
                result[expectedActionName] = operation;
            }
        });
    }
    return result;
};

var kirraGetCustomQueries = function(viewName, entity) {
    var queries = kirraGetCustomSettings(viewName, [entity.fullName], 'queries');
    var result = {};
    if (queries) {
        angular.forEach(queries, function(actualQueryName, expectedQueryName) {
            var query = kirraNG.findQuery(entity, actualQueryName);
            if (query == undefined) {
                console.error("Unknown query for mapping: " + actualQueryName + " -> " + expectedQueryName);
                return;
            }
            result[expectedQueryName] = query;
        });
    }
    return result;
};


var kirraBuildCustomInfo = function(viewName, entity) {
    var customMetadata = kirraBuildCustomMetadata(viewName, entity);
    var customInfo = {};
    customInfo.metadata = customMetadata;
    customInfo.data = [];
    customInfo.edgeData = {};
    customInfo.loadEdgeData = function(scope, instances, relationship) {
        var edgeMapping = kirraNG.find(customInfo.metadata.edges, function(edgeMapping) { 
            return edgeMapping.relationship.name == relationship.name;
        });
        var relatedEntity = entitiesByName[relationship.typeRef.fullName];
        if (edgeMapping) {
            var edgeDataLoader = kirraGetCustomViewData(relatedEntity, edgeMapping.slots, edgeMapping.edgeActions, relationship);
            customInfo.edgeData[edgeMapping.name] = edgeDataLoader(scope, instances);
        }
    };
    customInfo.loadData = function(scope, instances, preserve) {
        var loadedData = customInfo.metadata.dataLoader(scope, instances);
        if (preserve) {
            Array.prototype.push.apply(customInfo.data, loadedData);
        } else {
            customInfo.data = loadedData;
        }
//                angular.forEach(customInfo.metadata.edges, function(value, edgeName) {
//                    var loadedEdgeData = customInfo.metadata.edgeDataLoader(instances);
//                    customInfo.edgeData = loadedEdgeData;
//                    customInfo.edgeData[edgeName] = 
//                });
    };
    return customInfo;
};

var kirraGetCustomViewData = function(entity, slots, instanceActions, relationship) {
    var singleMapper = function(scope, instance, inList) {
        if (!instance) {
            return undefined;
        }
        var result = {
            objectId: instance.objectId,
            shorthand: instance.shorthand
        };
        angular.forEach(slots, function(slot, expected) {
            if (slot.style) {
                kirraNG.setViewDataForRelationship(result, instance, slot, expected);
            } else {
                kirraNG.setViewDataForProperty(result, instance, slot, expected);
            }
        });
        angular.forEach(instanceActions, function(action, expected) {
            result[expected] = function(args) {
                console.log(instance);
                console.log(inList);
                if (relationship) {
                    scope.performActionOnRelatedInstance(relationship, action, result.objectId, result.shorthand, args);
                } else if (inList) {
                    scope.performInstanceActionOnRow(instance, action, args);
                } else {
                    scope.performInstanceAction(action, instance, args);
                }
//                var injector = angular.element(document.body).injector();
//                var instanceService = injector.get('instanceService');
//                var $state = injector.get('$state');
//                kirraNG.handleInstanceAction($state, instanceService, entity, instance, action)
//                    .then(function(reloadedInstance) {
//                        console.log(result);
//                        var newMapped = singleMapper(reloadedInstance, idx, array);
//                        if (newMapped) {
//                            angular.merge(result, newMapped);
//                        }
//                    });
            };
        });
        return result;
    };
    var arrayMapper = function(scope, instances, multiple) {
        return kirraNG.map(instances, function(instance) { return singleMapper(scope, instance, multiple); });
    };
    var mappingFunction = function(scope, instances) {
        var isArray = angular.isArray(instances);
        return arrayMapper(scope, isArray ? instances : [instances], isArray);
    };
    return mappingFunction;
};

var kirraGetCustomEdgeViewData = function(viewName, entity, customViewMetadata) {
    var edgeMapping = customViewMetadata.edgeMapping;
    var singleMapper = function(genericEdgeViewData) {
        return {};
    };
    var arrayMapper = function(genericViewData) {
        return kirraNG.map(genericViewData, singleMapper);
    };
    return arrayMapper;
};

kirraNG.getTemplateUrl = function(template) {
    return kirraGetTemplateUrl(template);
};

kirraNG.getImageUrl = function(imageUrl) {
    return kirraBasePath + imageUrl;
};

kirraNG.getElementLabel = function(elementSpec, stateName) {
    var segments = elementSpec.split(".");
    var entityMappings = kirraGetCustomSettings('', [], 'entityMapping', application.currentUserRoles);
    var canonicalEntityName = segments[0] + "." + segments[1];
    var actualEntityName = entityMappings[canonicalEntityName];
    var entity = entitiesByName[actualEntityName];
    if (!entity)
        return elementSpec;
    var kind = segments[2];
    var element;
    if (kind == 'queries') {
        var canonicalQueryName = segments[3];
        var customQueries = kirraGetCustomQueries('', entity);
        var customQuery = customQueries[canonicalQueryName];
        element = customQuery;
    } else if (kind == 'list') {
        var canonicalQueryName = 'extent';
        element = entity;
    }
    var stateSuffix = stateName.split(":")[2];
    var currentEntityName = kirraNG.fromStateToEntityName(stateName);
    var customLabel = kirraGetCustomSettings('', [currentEntityName], 'labels', application.currentUserRoles, function(labels) {
        return labels[stateSuffix] && labels[stateSuffix][elementSpec];    
    });
    return customLabel ? customLabel : (element ? element.label : elementSpec);
};

kirraNG.getAppLabel = function(token, substitutions) {
    var token = token.toLowerCase();
    var tokenSegments = token.split('.');
    var defaultLabels = kirraDefaultAppLabels;
    var customLabels = kirraAppLabels;
    for (var i = 0; i < tokenSegments.length - 1; i++) {
        defaultLabels = defaultLabels && defaultLabels[tokenSegments[i]];
        customLabels = customLabels && customLabels[tokenSegments[i]];
    }
    var lastSegment = tokenSegments[tokenSegments.length - 1];
    var labelTemplate = (customLabels && customLabels[lastSegment]) || (defaultLabels && defaultLabels[lastSegment]) || token;
    var resolvedLabel = labelTemplate;
    if (substitutions) {
        for (var key in substitutions) {
            resolvedLabel = resolvedLabel.replace('{' + key + '}', substitutions[key]);
        }
    }
    return resolvedLabel;
};


kirraNG.capitalize = function(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
};

kirraNG.filter = function(arrayOrMap, filter, mapping) {
    var result = [];
    mapping = mapping || function(it) { return it; };
    angular.forEach(arrayOrMap, function(value, key, object) {
        if (filter(value, key, object)) {
            result.push(mapping(value, key, object));
        }
    });
    return result;
};

kirraNG.intersect = function(array1, array2) {
    return $.grep(array1, function(element) {
        return $.inArray(element, array2) !== -1;
    });
};

kirraNG.find = function(arrayOrMap, filter) {
    var found = undefined;
    angular.forEach(arrayOrMap, function(it, it2) {
        if (!found && filter(it, it2)) {
            found = it;
        }
    });
    return found;
};

kirraNG.findIndex = function(array, filter) {
    var found = undefined;
    angular.forEach(array, function(it, index) {
        if (found == undefined && filter(it, index)) {
            found = index;
        }
    });
    return found;
};


kirraNG.map = function(arrayOrMap, mapping) {
    return kirraNG.filter(arrayOrMap, function() { return true; }, mapping);
};

kirraNG.generateHtmlName = function(camelCase) {
    return camelCase.replace(/([a-z])([A-Z])/g, '$1-$2').replace('.', '-').toLowerCase();
}

kirraNG.generateInstanceListControllerName = function(entity) {
    return entity.fullName + 'InstanceListCtrl';
};

kirraNG.generateEntityServiceName = function(entity) {
    return entity.fullName + 'Service';
};

kirraNG.toState = function(entityFullName, kind) {
    return entityFullName.replace('.', ':') + ":" + kind;
};

kirraNG.fromStateToEntityName = function(stateName) {
    var components = stateName.split(":");
    return components[0] + "." + components[1];
};

kirraNG.generateEntitySingleStateName = function(entity) {
    return entity.fullName.replace('.', ':') + ".single";
};

kirraNG.filterCandidates = function(instances, value) {
    value = value && value.toUpperCase();
    var filtered = kirraNG.filter(instances, 
        function(it) { 
            return (it.shorthand.toUpperCase().indexOf(value) == 0); 
        },
        function(it) { return it; }
    );
    return (filtered && filtered.length > 0) ? filtered : instances;
}; 

kirraNG.buildTableColumns = function(entity, global) {
    return kirraNG.findProperties(entity, function(property) {
        return (property.userVisible && (!global || property.typeRef.typeName != 'Memo'));
    }, function(relationship) {
        return relationship.userVisible && !relationship.multiple;
    });
};

kirraNG.findProperties = function(entity, propertyPredicate, relationshipPredicate) {
    var selectedColumns = [];
    relationshipPredicate = relationshipPredicate || propertyPredicate;
    angular.forEach(entity.properties, function(property) {
        if (propertyPredicate(property)) {
            selectedColumns.push(property);
        }
    });
    angular.forEach(entity.relationships, function(relationship) {
        if (relationshipPredicate(relationship)) {
            selectedColumns.push(relationship);
        }
    });
    kirraNG.sortFields(entity, selectedColumns);
    return selectedColumns;
};

kirraNG.togglePickerStatus = function ($event, $scope, propertyName) { 
    $event.stopPropagation();
    if (!$scope.pickerStatus) {
        $scope.pickerStatus = {};
    }
    $scope.pickerStatus[propertyName] = !$scope.pickerStatus[propertyName];
};

kirraNG.buildInputFields = function(entity, createMode) {
    if (typeof entity == 'string') {
        entity = kirraNG.getEntity(entity);
    }
    console.log("buildInputFields(" + entity.fullName + ", " + createMode + ")")
    var inputFields = [];
    angular.forEach(entity.properties, function(property) {
        if (property.userVisible && ((createMode && property.initializable) || (!createMode && property.editable))) {
            inputFields.push(property);
            property['inputKind'] = 'property';
        }
    });
    angular.forEach(entity.relationships, function(relationship) {
        if (relationship.userVisible && !relationship.multiple && ((createMode && relationship.initializable) || (!createMode && relationship.editable))) {
            inputFields.push(relationship);
            relationship['inputKind'] = 'relationship';
        }
    });
    kirraNG.sortFields(entity, inputFields);
    console.log("buildInputFields(" + entity.fullName + ", " + createMode + ") = " + inputFields.length)
    return inputFields;
};

kirraNG.sortFields = function(entity, fields) {
    var orderedDataElements = kirraNG.getOrderedDataElements(entity);
    fields.sort(function(a, b) { 
        return orderedDataElements.indexOf(a.name) - orderedDataElements.indexOf(b.name); }
    );
};

kirraNG.buildViewFields = function(entity) {
    var viewFields = [];
    angular.forEach(entity.properties, function(property) {
        if (property.userVisible) {
            viewFields.push(property);
        }
    });
    angular.forEach(entity.relationships, function(relationship) {
        if (relationship.userVisible && !relationship.multiple) {
            viewFields.push(relationship);
        }
    });
    kirraNG.sortFields(entity, viewFields);
    return viewFields;
};

kirraNG.getEnabledActions = function(instance, instanceActions) {
    return kirraNG.filter(instanceActions, function(action) { 
        return instance.disabledActions && instance.disabledActions[action.name] == undefined;
    });
};

// this version is required to workaround a weird issue were using an object (as
// the basic buildViewData does) would cause all sorts of problems
kirraNG.buildViewDataAsArray = function(entity, instance) {
    // need to preserve order to allow retrieval by index
    var fieldValuesByName = kirraNG.buildViewData(entity, instance);
    var orderedDataElements = kirraNG.getOrderedDataElements(entity); 
    var fieldValues = [];
    angular.forEach(orderedDataElements, function(name) {
        if (fieldValuesByName.hasOwnProperty(name)) {
            fieldValues.push(fieldValuesByName[name]);
        }
    });
    return fieldValues;
};

kirraNG.getOrderedDataElements = function(entity) {
    if (entity.orderedDataElements) {
        return entity.orderedDataElements;
    }
    var orderedDataElements = [];
    angular.forEach(entity.properties, function(property, name) {
        if (property.userVisible) {
            orderedDataElements.push(name);
        }
    });
    angular.forEach(entity.relationships, function(relationship, name) {
        if (relationship.userVisible && !relationship.multiple) {
            orderedDataElements.push(name);
        }
    });
    return orderedDataElements;
};

kirraNG.buildViewData = function(entity, instance) {
    var data = {};
    angular.forEach(entity.properties, function(property) {
        kirraNG.setViewDataForProperty(data, instance, property);
    });
    angular.forEach(entity.relationships, function(relationship) {
        kirraNG.setViewDataForRelationship(data, instance, relationship);
    });
    return data;
};

/** Handles a user action requesting an instance action to be performed. */
kirraNG.handleInstanceAction = function($state, instanceService, entity, instanceRef, action, actionArguments, parameterSet) {
    if (action.parameters.length > 0 && !actionArguments) {
        $state.go(kirraNG.toState(entity.fullName, 'performInstanceAction'), { objectId: instanceRef.objectId, shorthand: instanceRef.shorthand, actionName: action.name } );
        return { 
            then: function(fn) { 
                /* we do not call back in this case */
                return this;
            }
        };
    }
    return instanceService.performInstanceAction(entity, instanceRef.objectId, action.name, actionArguments, parameterSet)
        .then(
            function(response) {
                console.log("Action Response: ");
                console.log(response);
                var result;
                if (action.typeRef && action.typeRef.kind == 'Entity') {
                    // load the action response
                    result = response.data[0];
                } else {
                    // reload the instance the action was performed on
                    result = instanceService.get(entity, instanceRef.objectId, { ignoreErrors: [404] });
                }
                return result;
            }
        );
};

kirraNG.setViewDataForProperty = function(data, instance, property, alternativeSlotName) {
    var slotName = alternativeSlotName || property.name;
    if (property.userVisible) {
        var rawValue = instance.values[property.name]; 
        data[slotName] = property.mappingFn === undefined ? rawValue : property.mappingFn(rawValue, property.name, instance);
    }
};

kirraNG.setViewDataForRelationship = function(data, instance, relationship, alternativeSlotName) {
    var slotName = alternativeSlotName || relationship.name;
    if (relationship.userVisible && !relationship.multiple) {
        var link = instance.links[relationship.name];
        data[slotName] = link ? (
            relationship.mappingFn ? relationship.mappingFn(link) : {
                shorthand: link.shorthand,
                objectId: link.objectId 
            }
        ) : {}
    }
};

kirraNG.loadEntityCapabilities = function(loadedCallback) {
    repository.loadEntityCapabilities(function(loadedEntityCapabilities) {
        entityCapabilitiesByName = loadedEntityCapabilities;
        loadedCallback();
    });
};

kirraNG.buildRowData = function(instance, fixedEntity, fixedInstanceActions) {
    var entity = fixedEntity || entitiesByName[instance.typeRef.fullName];
    var instanceActions = fixedInstanceActions || kirraNG.getInstanceActions(entity);
    
    var data = kirraNG.buildViewData(entity, instance);
    var row = { 
        data: data, 
        raw: instance,
        actionEnablement: kirraNG.buildActionEnablement(instanceActions)
    };
    return row;
};

kirraNG.buildActionEnablement = function(instanceActions) {
    return {
        enabledActions: [],
        enabledActionNames: [],
        useDropdown: true,
        loaded: false,
        load: function(instance) {
            this.enabledActions = kirraNG.getEnabledActions(instance, instanceActions);
            this.useDropdown = this.enabledActions.length > 0;
            this.loaded = true;
            return this; 
        },
        reset: function() {
            this.loaded = false;
            enabledActions = [];
            useDropdown = true;
            return this;
        }
    };
};

kirraNG.buildTableData = function(instances, fixedEntity) {
    var rows = [];
    var fixedInstanceActions = fixedEntity && kirraNG.getInstanceActions(fixedEntity);
    angular.forEach(instances, function(instance){
        rows.push(kirraNG.buildRowData(instance, fixedEntity, fixedInstanceActions));
    });
    return rows;
};

kirraNG.getEntity = function(entityName) {
    var result = entitiesByName[entityName];
    console.log(entityName + "=" + (result == null));
    return result;
};

kirraNG.getInstanceActions = function(entity) {
    return kirraNG.filter(entity.operations, function(op) { return op.instanceOperation && op.kind == 'Action'; });
};

kirraNG.getEntityActions = function(entity) {
    return kirraNG.filter(entity.operations, function(op) { return !op.instanceOperation && op.kind == 'Action'; });
};

kirraNG.getMultiChildRelationships = function(entity) {
    return kirraNG.filter(entity.relationships, function(rel) { 
            return rel.style == 'CHILD' && rel.multiple && rel.userVisible; 
        });
};

kirraNG.getMultiRegularRelationships = function(entity) {
    return kirraNG.filter(entity.relationships, function(rel) { 
            return rel.style != 'CHILD' && rel.multiple && rel.userVisible; 
        });
};

kirraNG.findQuery = function(entity, queryName) {
    return kirraNG.find(entity.operations, function(op) { 
        var isQuery = !op.instanceOperation && op.kind == 'Finder' && op.typeRef.fullName == entity.fullName;
        return isQuery && queryName == op.name; 
    });
};


kirraNG.getQueries = function(entity) {
    return kirraNG.filter(entity.operations, function(op) { 
        var isMatch = !op.instanceOperation && op.kind == 'Finder' && op.typeRef.fullName == entity.fullName;
        return isMatch; 
    });
};

kirraNG.isEditable = function(entity) {
    var check = function (it) { return it.editable; };
    return kirraNG.find(entity.properties, check) || kirraNG.find(entity.relationships, check);
};

kirraNG.buildInstanceListController = function(entity) {
    var controller = function($scope, $state, instanceService) {
        
        var finderName = $state.params && $state.params.finderName;
        var finderArguments = $state.params && $state.params.arguments;
        var finder = finderName && entity.operations[finderName];
        var forceFetch = $state.params && $state.params.forceFetch;

        $scope.$state = $state;
        $scope.table = true;
        $scope.entity = entity;
        $scope.filtered = finderName != undefined;
        $scope.finder = finder;
        $scope.inputFields = finder && finder.parameters;
        $scope.parameterValues = finderArguments || {};
        $scope.entityName = entity.fullName;
        $scope.tableProperties = kirraNG.buildTableColumns(entity, true);
        $scope.pictureProperties = kirraNG.findProperties(entity, function (property) { return property.typeRef.typeName == 'Picture'; }, function (property) { return false; });
        $scope.actions = kirraNG.getInstanceActions(entity);
        $scope.anyListCapability = true;
        $scope.instances = undefined;
        $scope.rows = undefined;
        $scope.queries = kirraNG.getQueries(entity);
        $scope.entityActions = kirraNG.getEntityActions(entity);
        $scope.applyFilter = function() {
            var newStateParams = angular.merge({}, $state.params, { arguments: $scope.parameterValues, forceFetch: true });
            $state.go($state.current.name, newStateParams, { reload: true });
        };
        $scope.updateActionEnablement = function(row) {
            instanceService.get(entity, row.raw.objectId)
                .then(function(loaded) {
                    row.actionEnablement.load(loaded);
                }).catch(function(error) {
                    $scope.resultMessage = error.data.message;
                    $scope.clearAlerts();
                });
        };
        $scope.pageLength = undefined;
        $scope.pageOffset = undefined;
        $scope.custom = kirraBuildCustomInfo('instance-list', entity);
        angular.forEach(finderArguments, function (arg, name) {
            if (typeof(arg) == 'object' && arg instanceof Date) {
                finderArguments[name] = moment(arg).format("YYYY/MM/DD");
            }
        });
        
        var performQuery = function(queryArguments, forceFetch, pageNumber, dataHandler) {
            var missingArguments = kirraNG.filter(finder.parameters, function(p) { return p.required; }, function (p) { return p.name; } );
            angular.forEach(queryArguments, function(value, name) {
                var index = missingArguments.indexOf(name);
                if (index >= 0) {
                    missingArguments.splice(index, 1);
                }
            });
            if (missingArguments.length == 0) {
                $scope.loadingData = true;
                instanceService.performQuery(entity, finderName, queryArguments, pageNumber)
                    .then(dataHandler).catch(function(error) {
                        $scope.resultMessage = error.message || error.data.message;
                        $scope.clearAlerts();
                        $scope.loadingData = false;
                    });
            } else {
                var parameterLabels = kirraNG.map(missingArguments, function (parameterName) {
                    var parameter = kirraNG.find(finder.parameters, function (p) { return p.name == parameterName; });
                    return parameter.label; 
                });
                $scope.instances = [];
                $scope.rows = [];
                $scope.custom.loadData($scope, []);
                $scope.resultMessage = "Before you can apply this filter, you must fill in: " + parameterLabels.join(", ");
            }
        };
        
        var populateSingleRow = function(updatedInstance) {
            var rowIndex = kirraNG.findIndex($scope.instances, function(instance) {
                return updatedInstance.objectId == instance.objectId;
            });
            
            if (rowIndex == undefined) {
                return;
            }
            $scope.instances[rowIndex] = updatedInstance;
            $scope.rows[rowIndex] = kirraNG.buildRowData(updatedInstance);
            $scope.custom.loadData($scope, $scope.instances);
        };
        
        var populate = function(preserve) {
            $scope.custom.loadData(preserve);
            var pageLoaded = function(pagedInstances) {
            angular.merge($scope, pagedInstances);
                $scope.rows = kirraNG.buildTableData(pagedInstances.instances, entity);
                $scope.custom.loadData($scope, pagedInstances.instances);
                $scope.resultMessage = pagedInstances.instances.length > 0 ? "" : kirraNG.getAppLabel("no_data_found");
                $scope.moreData = pagedInstances.pageCount > pagedInstances.pageNumber;
                $scope.loadingData = false;
            };
            var additionalPageLoaded = function(pagedInstances) {
                var existingInstances = angular.copy($scope.instances);
                var existingRows = $scope.rows;
                // this will temporarily destroy the list of raw instances in this page
                angular.merge($scope, pagedInstances);
                // and this restores them
                $scope.instances = existingInstances;
                Array.prototype.push.apply(existingInstances, pagedInstances.instances);
                Array.prototype.push.apply(existingRows, kirraNG.buildTableData(pagedInstances.instances, entity));
                $scope.custom.loadData($scope, pagedInstances.instances, true);
                $scope.moreData = pagedInstances.pageCount > pagedInstances.pageNumber;
                $scope.loadingData = false;
            };
            
            var buildPageLoader = function(dataHandler) {
                return function(pageNumber) {
                    if (finder) {
                        performQuery(finderArguments, forceFetch, pageNumber, dataHandler);
                    } else {
                        $scope.loadingData = true;
                        instanceService.extent(entity, pageNumber).then(dataHandler);
                    }
                }
            };
            var singlePageLoader = buildPageLoader(pageLoaded);
            var additionalPageLoader = buildPageLoader(additionalPageLoaded);
            $scope.pageChanged = singlePageLoader;
            $scope.loadMore = function() {
                return additionalPageLoader($scope.pageNumber + 1);
            };
            $scope.pageChanged(1);
        };
        
        instanceService.getEntityCapabilities(entity).then(
            function(loaded) {
                var entityCapabilities = loaded.data;
                $scope.entityCapabilities = entityCapabilitiesByName[entity.fullName] = entityCapabilities;
                if (finderName) {
                    if (!entityCapabilities.queries[finderName] || entityCapabilities.queries[finderName].length == 0) {
                        // we don't actually have permission for the requested
                        // query
                        $scope.finder = finder = undefined;
                    }
                    populate();
                } else {
                    if (entityCapabilities.entity.indexOf('List') == -1) {
                        // no permission to list all instances, fallback to
                        // first query that we can execute
                        var firstQuery = kirraNG.find($scope.queries, function(q) { 
                            return entityCapabilities.queries[q.name] && entityCapabilities.queries[q.name].length > 0; 
                        });
                        if (firstQuery) {
                            $scope.performQuery(firstQuery);
                        } 
                    } else {
                        populate();
                    }
                }
            },
            function(error) {
                populate();
                $scope.entityCapabilities = undefined;
            }
        );
        
        $scope.findCandidatesFor = function(parameter, value) {
            return instanceService.extent(entitiesByName[parameter.typeRef.fullName], 0, -1, 'empty').then(function(pagedInstances) {
                return kirraNG.filterCandidates(pagedInstances.instances, value);
            });
        };
        
        $scope.onCandidateSelected =  function(selectedCandidate, inputField, $label) {
            $scope.parameterValues[inputField.name] = selectedCandidate;
        };
        
        $scope.formatCandidate = function(inputField) {
            if (!$scope.parameterValues || !$scope.parameterValues[inputField.name]) {
                return '';
            }
            var value = $scope.parameterValues[inputField.name]; 
            return (value && value.shorthand) || value;
        };
        
        $scope.unfiltered = function() {
            $state.go(kirraNG.toState(entity.fullName, 'list'));
        };

        $scope.performInstanceActionOnRow = function(instance, action) {
            var objectId = instance.objectId;
            var shorthand = instance.shorthand; 
            
            var performResult = kirraNG.handleInstanceAction($state, instanceService, entity, { objectId: objectId, shorthand: shorthand }, action);
            if (performResult) {
                if (action.typeRef && action.typeRef.kind == 'Entity' && !action.multiple) {
                    // action returns a single object - show it!
                    performResult.then(function(instance) {
                        kirraNG.showSingleInstanceInResponse(instance);
                    });
                } else if (finder) {
                    performResult.then(function() {
                        instanceService.performQuery(entity, finderName, $scope.parameterValues, null, null, "full", [instance.typeRef.fullName + '@' + instance.objectId]).then(function(loadedInstances) {
                            var existingInstances = $scope.instances;
                            var existingRows = $scope.rows;
                            var existingCustomData = $scope.custom.data;
                            var index = kirraNG.findIndex(existingInstances, function(it) {
                                return it.objectId == instance.objectId;
                            });

                            if (loadedInstances.length == 0) {
                                // remove from all parallel lists
                                existingInstances.splice(index, 1);
                                existingRows.splice(index, 1);
                                existingCustomData.splice(index, 1);
                                $scope.instances = existingInstances;
                                $scope.rows = existingRows;
                                $scope.custom.data = existingCustomData;
                            } else {
                                // update in place in all parallel lists
                                populateSingleRow(loadedInstances[0]);
                            }
                        });
                    });
                    // need to figure out whether we update it in place or remove from view
                } else {
                    // when showing all, update only the row affected
                    performResult.then(
                        populateSingleRow
                    );
                }
            }
        };

        $scope.performQuery = function(finder) {
            $state.go(kirraNG.toState(entity.fullName, 'performQuery'), { 
                finderName: finder.name, 
                /* reset when switching */ arguments: {} 
            });
        };
        
        $scope.create = function() {
            $state.go(kirraNG.toState(entity.fullName, 'create'));
        };
    };
    controller.$inject = ['$scope', '$state', 'instanceService'];
    return controller;
};

kirraNG.buildInstanceEditController = function(entity, mode) {
    var creation = mode == 'create';
    var editing = mode == 'edit';
    var childCreation = mode == 'createChild';
    var childEditing = mode == 'editChild';
    var controller = function($scope, $state, $stateParams, instanceService, $q) {
        var objectId = $stateParams.objectId;
     
        // in this controller, because it is used both for editing parents and
        // children, the actual entity will depend on the mode
        var actualEntity;
        if (childCreation || childEditing) {
            var relationship = entity.relationships[$stateParams.relationshipName];
            $scope.parentEntity = entity;
            $scope.relationshipName = $stateParams.relationshipName;
            $scope.entity = actualEntity = entitiesByName[$stateParams.relatedEntity];
            $scope.childObjectId = $stateParams.childObjectId;
        } else {
            $scope.entity = actualEntity = entity;
        }

        var inputFields = kirraNG.buildInputFields(actualEntity, creation);
        
        $scope.inputFields = inputFields;
        
        $scope.mode = mode;
        $scope.$state = $state;
        $scope.objectId = objectId;
        $scope.actionEnablement = kirraNG.buildActionEnablement(kirraNG.getInstanceActions(actualEntity));
        $scope.entityName = actualEntity.fullName;
        $scope.propertyValues = {};
        $scope.linkValues = {};
        $scope.custom = kirraBuildCustomInfo('edit-instance', entity);
        $scope.loadInstanceCallback = function(instance) { 
            $scope.formLabel = creation ? (kirraNG.getAppLabel('creating') + ' ' + actualEntity.label) : (childCreation ? (kirraNG.getAppLabel('adding') + ' ' + actualEntity.label) : (kirraNG.getAppLabel('editing') + ' ' + actualEntity.label + ': ' + instance.shorthand)); 
            $scope.raw = instance;
            $scope.custom.loadData($scope, instance);
            $scope.actionEnablement.load(instance);
            angular.merge($scope.propertyValues, angular.copy(instance.values));
            angular.merge($scope.linkValues, angular.copy(instance.links));
            return instance;
        };
    
        
        $scope.findCandidatesFor = function(relationship, value) {
            var domain;
            var objectId = creation ? '_template' : $scope.objectId;
            if (childCreation) {
                var relatedEntity = entitiesByName[relationship.typeRef.fullName];
                domain = instanceService.extent(relatedEntity, 0, -1, 'empty');
            } else {
                domain = instanceService.getRelationshipDomain(actualEntity, objectId, relationship.name);
            }
            return domain.then(function(instances) {
                var candidates = kirraNG.filterCandidates(instances, value);
                if (!relationship.required) {
                    candidates.splice(0, 0, { shorthand: '- None -' });
                } 
                return candidates; 
            });
        };
        
        $scope.onCandidateSelected =  function(selectedCandidate, inputField, $label) {
            $scope.linkValues[inputField.name] = selectedCandidate.objectId ? selectedCandidate : null;
        };
        
        $scope.formatCandidate = function(inputField) {
            if (!$scope.linkValues || !$scope.linkValues[inputField.name]) {
                return '';
            }
            var value = $scope.linkValues[inputField.name];
            return (value && value.shorthand) || value;
        };
        
        $scope.cancel = function() {
            window.history.back();
        };
        
        $scope.save = function() {
            console.log("Save pressed");
            var newValues = angular.copy($scope.propertyValues);
            console.log(newValues);
            var newLinks = angular.copy($scope.linkValues);
            var newRepresentation = { values: newValues, links: newLinks };
            console.log("newRepresentation");
            console.log(newRepresentation);
            if (creation) {
                instanceService.post(actualEntity, newRepresentation).then(function(created) {
                    $state.go(kirraNG.toState(actualEntity.fullName, 'show'), { objectId: created.objectId } ); 
                });
            } else if (editing || childEditing) {
                newRepresentation.objectId = $scope.objectId;
                instanceService.put(actualEntity, newRepresentation).then(function() { window.history.back(); });
            } else if (childCreation) {
                var relationship = $scope.parentEntity.relationships[$scope.relationshipName];
                newRepresentation.links[relationship.opposite] = { objectId: $scope.objectId, scopeName: $scope.parentEntity.name, scopeNamespace: $scope.parentEntity.namespace };
                instanceService.post(actualEntity, newRepresentation).then(function(created) {
                    $state.go(kirraNG.toState($scope.parentEntity.fullName, 'show'), { objectId: $scope.objectId } ); 
                });
            }
        };
        instanceService.get(actualEntity, editing ? objectId : '_template').then($scope.loadInstanceCallback);
    };
    controller.$inject = ['$scope', '$state', '$stateParams', 'instanceService', '$q'];
    return controller;
};

kirraNG.buildActionController = function(entity) {
    var controller = function($scope, $state, $stateParams, instanceService, $q) {
        var objectId = $stateParams.objectId;
        var actionName = $stateParams.actionName;
        var action = entity.operations[actionName];

        $scope.$state = $state;
        $scope.objectId = objectId;
        $scope.entity = entity;
        $scope.entityName = entity.fullName;
        $scope.actionName = actionName;
        $scope.action = action;
        $scope.inputFields = action.parameters;
        $scope.inputFieldGroups = action.parameterSets;
        $scope.parameterValues = {};
        $scope.selectedInputGroup = action.parameterSets.length ? action.parameterSets[0].name : undefined;
        $scope.selectInputGroup = function(newInputGroup) {
            $scope.selectedInputGroup = newInputGroup && newInputGroup.name;
        };
        angular.forEach(action.parameters, function(it) {
            if (it.effect == 'Creation') {
                $scope.parameterValues[it.name] = {
                    propertyValues: {},
                    linkValues: {}
                };
                var parameterEntity = kirraNG.getEntity(it.typeRef.fullName);
                instanceService.getTemplate(parameterEntity).then(function(template) {
                    // update scope objects in place as they have been aliased 
                    angular.merge($scope.parameterValues[it.name].propertyValues, angular.copy(template.values));
                    angular.merge($scope.parameterValues[it.name].linkValues, angular.copy(template.links));
                });
            } else {
                $scope.parameterValues[it.name] = undefined;
            }
        });
        
        if (objectId) {
            instanceService.get(entity, objectId).then(function(instance) { 
                $scope.shorthand = instance.shorthand; 
            });
        }
        
        $scope.findCandidatesFor = function(parameter, value) {
            var domain = instanceService.getParameterDomain(entity, $scope.objectId, actionName, parameter.name);
            return domain.then(function(instances) { return kirraNG.filterCandidates(instances, value); });
        };
        
        $scope.onCandidateSelected =  function(selectedCandidate, inputField, $label) {
            $scope.parameterValues[inputField.name] = selectedCandidate;
        };
        
        $scope.formatCandidate = function(inputField) {
            if (!$scope.parameterValues || !$scope.parameterValues[inputField.name]) {
                return '';
            }
            var value = $scope.parameterValues[inputField.name];
            return (value && value.shorthand) || value;
        };
        
        $scope.cancel = function() {
            window.history.back();
        };
        
        $scope.performAction = function(context) {
            var actionArguments = {};
            angular.forEach(action.parameters, function(it) {
                if (it.effect == 'Creation') {
                    var parameterEntity = kirraNG.getEntity(it.typeRef.fullName);
                    var newArgumentInstance = {};
                    newArgumentInstance.values = $scope.parameterValues[it.name].propertyValues;
                    newArgumentInstance.links = $scope.parameterValues[it.name].linkValues;
                    actionArguments[it.name] = newArgumentInstance;
                } else
                    actionArguments[it.name] = $scope.parameterValues[it.name];
            });
            var objectId = $scope.objectId;
            var shorthand = $scope.shorthand;
            var selectedParameterSet = $scope.selectedInputGroup;
            if (objectId == undefined) {
                instanceService.performEntityAction(entity, action.name, actionArguments, selectedParameterSet).then(kirraNG.handleActionResponse($state, entity, action.name));
            } else {
                kirraNG.handleInstanceAction($state, instanceService, entity, { objectId: objectId, shorthand: shorthand }, action, actionArguments, selectedParameterSet)
                    .then(kirraNG.handleActionResultInstance(entity, actionName), function() {});
            }
        };
    };
    controller.$inject = ['$scope', '$state', '$stateParams', 'instanceService', '$q'];
    return controller;
};


kirraNG.showSingleInstanceInResponse = function(instance) {
    var injector = angular.element(document.body).injector();
    var $state = injector.get('$state');
    var entity = entitiesByName[instance.typeRef.fullName]
    $state.go(kirraNG.toState(entity.fullName, 'show'), { objectId: instance.objectId } );
}

kirraNG.handleActionResponse = function ($state, entity, actionName, fallbackFn) {
        var actionResultHandler = kirra.handleActionResultInstance(entity, actionName, fallbackFn);
        return function(response) {
            if (response.status < 200 || response.status > 299) {
                // let the generic error handler log it
                return;
            }
            return actionResultHandler(action.typeRef && action.typeRef.kind == 'Entity' && !action.multiple ? response.data[0] : response);
        };
};

kirraNG.handleActionResultInstance = function (entity, actionName, fallbackFn) {
    var injector = angular.element(document.body).injector();
    var $state = injector.get('$state');
    return function(resultInstance) {
        var action = actionName && entity.operations[actionName];
        if (action.typeRef && action.typeRef.kind == 'Entity') {
            if (action.multiple) {
                $state.go(kirraNG.toState(entity.fullName, 'list'));                        
            } else {
                kirraNG.showSingleInstanceInResponse(resultInstance);
            }
            return true;
        } else {
            if (fallbackFn) {
                return fallbackFn(response);
            }
            window.history.back();
        }
        return;
    };
};


kirraNG.buildInstanceLinkController = function(entity) {
    var controller = function($scope, $modalInstance, instanceService, objectId, relationship) {
        $scope.objectId = objectId;
        $scope.relationship = relationship;
        instanceService.getRelationshipDomain(entity, objectId, relationship.name).then(function(candidates) {
            $scope.candidates = candidates;
        });
        $scope.findCandidatesFor = function(relationship, value) {
            var domain = instanceService.getRelationshipDomain(entity, objectId, relationship.name);
            return domain.then(function(instances) { return kirraNG.filterCandidates(instances, value); });
        };
        $scope.onCandidateSelected =  function(selectedCandidate) {
            $scope.selected = selectedCandidate;
        };
        $scope.formatCandidate = function() {
            if (!$scope.selected) {
                return '';
            }
            var value = $scope.selected;
            return (value && value.shorthand) || value;
        };
        $scope.ok = function() {
            $modalInstance.close($scope);
        };
        $scope.cancel = function() {
            $modalInstance.dismiss();
        };
        
    };
    return controller;
};

kirraNG.buildDashboardController = function() {
//    console.log("dashboard entities: ");
//    console.log(entities);
    var controller = function($scope, $state, $stateParams, instanceService, $q, $http) {
        var metrics = [];
        angular.forEach(entities, function (entity) {
            var queries = kirraNG.filter(entity.operations, function(op) { 
                var isMatch = !op.instanceOperation && op.kind == 'Finder';
                return isMatch; 
            });
            angular.forEach(queries, function (query) {
                var entityCapabilities = entityCapabilitiesByName[entity.fullName];
                if (query.parameters && query.parameters.length > 0) {
                    return;
                }
                var queryCapabilities = entityCapabilities.queries && entityCapabilities.queries[query.name];
                if (!queryCapabilities || queryCapabilities.indexOf('StaticCall') < 0) {
                    return;
                }
                var multiple = query.multiple;
                var entityReturning = query.typeRef.kind == 'Entity';
                if (entityReturning && !multiple) {
                        // not supporting single instances at this point
                        return;
                }
                var metricUri = (entityReturning && multiple) ?
                                entity.finderMetricUriTemplate.replace('(finderName)', query.name) : 
                                entity.finderUriTemplate.replace('(finderName)', query.name);
                var metric = {
                    query: query,
                    entity: entity,
                    result: "-",
                    metricUri: metricUri,
                    // we show actual results for queries returning tuples
                    datatable: multiple && !entityReturning
                };
                metrics.push(metric);
            });
        });
        $scope.metrics = metrics.slice();
        var loadMetrics;
        loadMetrics = function () {
            var next = metrics.shift();
            if (next) {
                $http.get(next.metricUri, {}).then(function(response) {
                    if (next.multiple) {
                        next.result = response.data.contents;
                    } else {
                        next.result = response.data.contents[0].shorthand || response.data.contents[0];  
                    }
//                    console.log("next.result=");
//                    console.log(next.result);
                }).then(loadMetrics);
            }
        };
        $scope.loadMetrics = loadMetrics;
    };
    controller.$inject = ['$scope', '$state', '$stateParams', 'instanceService', '$q', '$http'];
    return controller;
};

kirraNG.mergeEdgeRowDatas = function(rows, newRows) {
        rows.length = 0;
        newRows.forEach(function(value, index) {
            rows.push(value);        
        });
};

kirraNG.buildInstanceShowController = function(entity) {
    var controller = function($scope, $state, $stateParams, instanceService, instanceViewService, $q, $modal, kirraNotification) {

        var objectId = $stateParams.objectId;

        if (!objectId) {
            kirraNotification.logError("No object provided");
            return;
        }
        
        $scope.$state = $state;
        $scope.objectId = objectId;

        $scope.entity = entity;

        $scope.entityName = entity.fullName;
        
        if (!entity.topLevel) {
            $scope.parentRelationship = kirraNG.find(entity.relationships, function(r) { return r.style = 'PARENT'; });
        }
        
        $scope.editable = kirraNG.isEditable(entity);

        $scope.loadInstanceCallback = function(instance) { 
            var instanceActions = kirraNG.getInstanceActions(entity);
            $scope.raw = instance;
            $scope.custom.loadData($scope, instance);
            $scope.actionEnablement = kirraNG.buildActionEnablement(instanceActions).load(instance);
            $scope.instanceActions = instanceActions;
            $scope.fieldValues = kirraNG.buildViewDataAsArray(entity, instance);
            if (!$scope.relatedData)
                    $scope.relatedData = [];
            if (!$scope.childrenData)
                    $scope.childrenData = [];
            if (!entity.topLevel) {
                $scope.parentLink = instance.links[$scope.parentRelationship.name];
            }
            instanceService.getInstanceCapabilities(entity, objectId).then(function(loaded) {
                var capabilities = loaded.data;
                $scope.instanceCapabilities = capabilities;     
            });
            return instance;
        };
    
        $scope.viewFields = kirraNG.buildViewFields(entity);
        $scope.custom = kirraBuildCustomInfo('show-instance', entity);

        $scope.edit = function() {
            console.log(entity);
            $state.go(kirraNG.toState(entity.fullName, 'edit'), { objectId: objectId } );
        };
        
        $scope.delete = function() {
            instanceService.delete(entity, objectId).then(function() {
                window.history.back();
            });
        };
        
        $scope.unlink = function(relationship, relatedEntityName, otherId) {
            instanceService.unlink(entity, objectId, relationship.name, relatedEntityName + '@' + otherId).then(function() {
                return instanceService.get(entity, objectId).then($scope.loadInstanceCallback).then($scope.loadInstanceRelatedCallback);
            });
        };
        
        $scope.link = function(relationship, relatedEntity) {
            var objectId = this.objectId;
            var modal = $modal.open({
              animation: true,
              templateUrl: kirraGetTemplateUrl('link-instance', undefined, $scope.currentUserRoles),
              size: 'lg',
              controller: entity.fullName + 'InstanceLinkCtrl', 
              resolve: {
                objectId: function() { return objectId; },
                relationship: function() { return relationship; },
              }
            });
            modal.result.then(function(scope) {
                return instanceService.link(entity, objectId, relationship.name, relatedEntity.fullName + '@' + scope.selected.objectId);
            }).then(function() {
                return instanceService.get(entity, objectId);
            }).then($scope.loadInstanceCallback).then($scope.loadInstanceRelatedCallback); 
        };

        $scope.createChild = function(relationship, relatedEntity) {
            $state.go(kirraNG.toState(entity.fullName, 'createChild'), { objectId: this.objectId, relationshipName: relationship.name, relatedEntity: relatedEntity.fullName } );
        };

        $scope.performAction = function(action) {
            var actionHandled = kirraNG.handleInstanceAction($state, instanceService, entity, 
                { objectId: objectId, shorthand: undefined }, action
            );
            var instanceLoaded = actionHandled.then($scope.loadInstanceCallback);
            var relatedLoaded = instanceLoaded.then($scope.loadInstanceRelatedCallback);
            return relatedLoaded;
        };
        
        /** User triggered an action on a child/related object. */
        $scope.performActionOnRelatedInstance = function(relationship, action, relatedObjectId, shorthand) {
            var relatedEntity = entitiesByName[relationship.typeRef.fullName];
            kirraNG.handleInstanceAction($state, instanceService, relatedEntity, 
                    { objectId: relatedObjectId, shorthand: shorthand }, action)
                .then($scope.loadInstanceRelatedCallback, $scope.loadInstanceRelatedCallback)
                .then(function(result) {
                    return instanceService.get(entity, objectId);
                })
                .then($scope.loadInstanceCallback);
        };

        /*
         * Data for multivalued relationships is kept in the form of edgeDatas.
         * An edgeData is meant to be bound to a scope, and is the basis for
         * dynamic UI rendering. The edgeData includes both metadata about the
         * relationship, and the data for that relationship (rows).
         */
        var buildEdgeData = function(relationship) {
            var relatedEntity = entitiesByName[relationship.typeRef.fullName];
            var newArrayWithTimestamp = [];
            newArrayWithTimestamp.timestamp = new Date();
            var edgeData = {
                relationshipLabel: relationship.label,
                relationshipStyle: relationship.style,
                relationship: relationship, 
                relatedEntity: relatedEntity,
                relatedViewFields: kirraNG.buildViewFields(relatedEntity),
                relatedInstanceActions: kirraNG.getInstanceActions(relatedEntity),
                performInstanceActionOnRow: function(row, action) {
                    var relatedInstance = row.raw;
                    var relatedObjectId = relatedInstance.objectId;
                    var shorthand = relatedInstance.shorthand; 
                    $scope.performActionOnRelatedInstance(relationship, action, relatedObjectId, shorthand);
                },
                rows: []
            };
            return edgeData;
        };
        
        var childRelationships = kirraNG.getMultiChildRelationships(entity);
        var regularRelationships = kirraNG.getMultiRegularRelationships(entity);
        var multipleRelationships = childRelationships.concat(regularRelationships);
        
        var edgeDatas = kirraNG.map(multipleRelationships, buildEdgeData);
        $scope.edges = edgeDatas; 
        
        $scope.loadInstanceRelatedCallback = function(relationshipData) {
            var relationshipTasks = [];
             
            angular.forEach(multipleRelationships, function(relationship) {
                var relatedEntity = entitiesByName[relationship.typeRef.fullName];
                var edgeData = kirraNG.find(edgeDatas, function (edgeData) { return edgeData.relationship == relationship });
                // take subtyping into account (every concrete subtype gets its
                // own edgeData
                if (edgeData.relatedEntity.subTypes && edgeData.relatedEntity.subTypes.length > 0) {
                    angular.forEach(edgeData.relatedEntity.subTypes, function (subType) {
                        var subEntity = entitiesByName[subType.fullName];
                        if (subEntity.concrete) {
                            // TODO-RC this is inconsistent - use a single
                            // function to build edgeData
                            edgeDatas.push({
                                relationshipLabel: relationship.label + " (" + subType.typeName + ")",
                                relationship: relationship, 
                                relatedEntity: subEntity, 
                                rows: [] 
                            });
                        }
                    });
                }
                
                var next = instanceService.getRelated(entity, objectId, relationship.name).then(function(relatedInstances) {
                    // the list of related instances may be heterogeneous - need
                    // to find the proper edgeData object to inject the results
                    // into
                    var tableData = kirraNG.map(relatedInstances, function(relatedInstance) { 
                        return {
                            data: kirraNG.buildViewDataAsArray(relatedEntity, relatedInstance),
                            raw: relatedInstance
                        };
                    });
                    $scope.custom.loadEdgeData($scope, relatedInstances, relationship);
                    kirraNG.mergeEdgeRowDatas(edgeData.rows, tableData);
                });
                relationshipTasks.push(next);
            });
            return $q.all(relationshipTasks);
        };

        instanceService.get(entity, objectId).then($scope.loadInstanceCallback).then($scope.loadInstanceRelatedCallback);
    };
    controller.$inject = ['$scope', '$state', '$stateParams', 'instanceService', 'instanceViewService', '$q', '$modal', 'kirraNotification'];
    return controller;
};

kirraNG.buildInstanceViewService = function() {
    var serviceFactory = function(instanceService, $q) {

        var InstanceView = function (data) {
            angular.extend(this, data);
        };
            
        InstanceView.loadAllRelatedInstances = function(loadedInstance, edgeLoader) {
            var entity = entitiesByName[loadedInstance.typeRef.fullName];
            var objectId = loadedInstance.objectId;
            var childRelationships = kirraNG.getMultiChildRelationships(entity);
            var regularRelationships = kirraNG.getMultiRegularRelationships(entity);
            var multipleRelationships = childRelationships.concat(regularRelationships);
            return this.loadRelatedInstancesForRelationships(entity, objectId, multipleRelationships, edgeLoader);
        };
        
        InstanceView.loadRelatedInstancesForRelationships = function(entity, objectId, multipleRelationships, edgeLoader) {
            var relationshipTasks = [];
            
            angular.forEach(multipleRelationships, function(relationship) {
                var relatedEntity = entitiesByName[relationship.typeRef.fullName];
                var next = instanceService.getRelated(entity, objectId, relationship.name).then(
                    function(relatedInstances) {
                        edgeLoader(relatedInstances, relationship);
                    }
                );
                relationshipTasks.push(next);
            });
            return $q.all(relationshipTasks);
        };
            
        InstanceView.loadInstanceAndAllEdges = function(entity, objectId) {
            return instanceService.get(entity, objectId)
                .then(this.loadAllRelatedInstances);
        };
        return InstanceView;
    };
    return serviceFactory;
};


kirraNG.buildApplicationService = function() {
    var serviceFactory = function($http, $rootScope) {
        var Application = function() { };
        Application.application = {};
        Application.application.currentUserRoles = ['_NO_ROLES'];
        Application.application.currentUser = undefined;
        Application.loadApplication = function(applicationData) {
            if (applicationData.currentUser) {
                Application.application.currentUserRoles = applicationData.currentUserRoles;
                $http.get(applicationData.currentUser).then(function(loaded) {
                    Application.application.currentUser = loaded.data;
                    $rootScope.$broadcast('applicationUserChanged', Application.application);
                });
            } else {
                Application.application.currentUser = undefined;
                $rootScope.$broadcast('applicationUserChanged', Application.application);
            }
            $rootScope.$broadcast('applicationLoaded', Application.application);
        };
        
        return Application;
    };
    return serviceFactory;
};


kirraNG.buildInstanceService = function() {
    var serviceFactory = function($rootScope, $http) {
        var Instance = function (data) {
            angular.extend(this, data);
        };
        Instance.instanceListeners = { };
        Instance.actionListeners = { };
        Instance.registerListener = function(listener, listeners) {
            var key = Math.random().toString();
            listeners[key] = listener;
            return key;
        };

        Instance.registerInstanceListener = function(instance, listener) {
            if (instance) {
                listener.objectId = instance.objectId;
                listener.entityFullName = instance.typeRef.fullName;
                return Instance.registerListener(listener, Instance.instanceListeners);
            }
            return;
        };
        Instance.registerActionListener = function(entityFullName, actionName, listener) {
            listener.actionName = actionName;
            listener.entityFullName = entityFullName;
            return Instance.registerListener(listener, Instance.actionListeners);
        };
        Instance.unregisterListener = function(key) {
            delete Instance.listeners[key];
        };
        Instance.invokeCallback = function(callback) {
            try {
                callback();
            } catch (e) {
                console.error("Ignored");
                console.error(e);
            }
        };
        Instance.instanceLoaded = function(loadedInstance) {
            angular.forEach(Instance.instanceListeners, function(listener) {
                if (listener.objectId == loadedInstance.objectId && listener.typeRefFullName == loadedInstance.typeRef.fullName) {
                    Instance.invokeCallback(function() {
                        listener(loadedInstance, 'instanceLoaded');
                    });
                }
            });
        };
        Instance.actionPerformed = function(entity, actionName) {
            angular.forEach(Instance.actionListeners, function(listener) {
                if ((listener.entityFullName == '*' || listener.entityFullName == entity.fullName) && (listener.actionName == '*' || listener.actionName == actionName)) {
                    Instance.invokeCallback(function() {
                        listener(listener.entityFullName, listener.actionName, 'actionPerformed');
                    });
                }
            });
        };
        
        var buildInstanceFromData = function(instanceData) {
            var entity = entitiesByName[instanceData.typeRef.fullName];
            angular.forEach(entity.properties, function(property) {
                if (property.typeRef.typeName == 'Time') {
                    // TODO this is just a workaround
                    instanceData.values[property.name] = new Date("1970-01-01T" + instanceData.values[property.name] + "+00:00");
                }
            });
            Instance.instanceLoaded(instanceData);
            return instanceData;
        };
        Instance.loadOne = function (response) {
            var loaded = buildInstanceFromData(response.data);
            return loaded;
        };
        Instance.pageLoader = function (response) {
            var instances = Instance.loadMany(response);
            var pageLength = response.data.length;
            var pageSize = kirraDefaultPageSize;
            var itemOffset = response.data.offset;
            //0, 1, ...
            var pageNumber = 1 + itemOffset / pageSize;
            var pageCount = pageLength < pageSize ? pageNumber : (pageNumber + 1);
            // just an estimation
            var totalItems = pageCount * pageSize;
            return { 
                instances: instances, 
                itemOffset: itemOffset,
                // the actual number of items on this page
                pageLength: pageLength,
                // the maximum number of items on any page
                pageSize: pageSize,
                pageNumber: pageNumber,
                pageCount: pageCount,
                totalItems: totalItems 
            };

        };
        Instance.loadMany = function (response) {
            var instances = [];
            angular.forEach(response.data.contents, function(data){
                instances.push(buildInstanceFromData(data));
            });
            return instances;
        };
        
        var removeNulls = function(representation) {
            if (!representation) {
                return {};
            }
            return representation;
        };
        
        var massageArguments = function(entity, actionName, representation) {
            if (!representation) {
                return {};
            }
            if (_.isArray(representation)) {
                var asObject = {};
                var action = entity.operations[actionName];
                angular.forEach(action.parameters, function(parameter) {
                    asObject[parameter.name] = representation.shift();
                });
                return asObject;
            }
            return representation;
        }; 
        
        var beforeInstanceUpload = function(entity, instance) {
            if (!instance) {
                return {};
            }
            removeNulls(instance.values);
                angular.forEach(entity.properties, function(property) {
                        if (property.typeRef.typeName == 'Time') {
                                if (instance.values[property.name]) {
                                        var asTimeString = moment(instance.values[property.name]).format("HH:mm:ss")
                                        instance.values[property.name] = asTimeString;
                                }
                        }
            });
            
            return instance;
        };
        Instance.performInstanceAction = function(entity, objectId, actionName, actionArguments, parameterSet) {
            return $http.post(entity.instanceActionUriTemplate.replace('(objectId)', objectId).replace('(actionName)', actionName).replace('(parameterSet)', parameterSet || ''), massageArguments(entity, actionName, actionArguments))
                .then(function(result) {
                    Instance.actionPerformed(entity, actionName);
                    return result;
                });
        };
        Instance.performEntityAction = function(entity, actionName, actionArguments, parameterSet) {
            return $http.post(entity.entityActionUriTemplate.replace('(actionName)', actionName).replace('(parameterSet)', parameterSet), massageArguments(entity, actionName, actionArguments))
                .then(function(result) {
                    Instance.actionPerformed(entity, actionName);
                    return result;
                });
        };    
        Instance.unlink = function(entity, objectId, relationshipName, relatedObjectId) {
            return $http.delete(entity.relatedInstanceUriTemplate.replace('(objectId)', objectId).replace('(relationshipName)', relationshipName).replace('(relatedObjectId)', relatedObjectId), {});
        };
        Instance.link = function(entity, objectId, relationshipName, relatedObjectId) {
            return $http.put(entity.relatedInstanceUriTemplate.replace('(objectId)', objectId).replace('(relationshipName)', relationshipName).replace('(relatedObjectId)', relatedObjectId), {}).then(this.loadOne);
        };
        var applyOffset = function(uriTemplate, pageNumber, pageSize, dataProfile) {
            var first = ((pageNumber || 1) - 1) * pageSize;
            return uriTemplate.replace('(first)', first).replace('(maximum)', pageSize).replace('(dataProfile)', dataProfile || 'full');
        };
        Instance.extent = function (entity, pageNumber, pageSize, dataProfile) {
            var extentUri = applyOffset(entity.extentUriTemplate, pageNumber, pageSize || kirraDefaultPageSize, dataProfile);
            return $http.get(extentUri).then(
                pageNumber == undefined ? this.loadMany : this.pageLoader
            );
        };
        Instance.performQuery = function (entity, finderName, queryArguments, pageNumber, pageSize, dataProfile, subset) {
            var finderUri = applyOffset(entity.finderUriTemplate.replace('(finderName)', finderName), pageNumber, pageSize || kirraDefaultPageSize, dataProfile);
            var me = this;
            return $http.post(finderUri, { arguments: queryArguments, subset: subset }).then(
                (pageNumber == undefined && pageSize == undefined) ? me.loadMany : me.pageLoader
            );
        };
        Instance.getRelationshipDomain = function (entity, objectId, relationshipName) {
            var relationshipDomainUri = entity.relationshipDomainUriTemplate.replace('(objectId)', objectId).replace('(relationshipName)', relationshipName);
            return $http.get(relationshipDomainUri).then(this.loadMany);
        };
        Instance.getParameterDomain = function (entity, objectId, actionName, parameterName) {
            var parameterDomainUri = entity.instanceActionParameterDomainUriTemplate.replace('(objectId)', objectId).replace('(actionName)', actionName).replace('(parameterName)', parameterName);
            return $http.get(parameterDomainUri).then(this.loadMany);
        };
        
        Instance.get = function (entity, objectId, httpConfig) {
            var instanceUri = entity.instanceUriTemplate.replace('(objectId)', objectId);
            return $http.get(instanceUri, httpConfig).then(this.loadOne);
        };
        Instance.getTemplate = function (entity) {
            return $http.get(entity.instanceTemplateUriTemplate).then(this.loadOne);
        };

        Instance.put = function (entity, instance) {
            return $http.put(entity.instanceUriTemplate.replace('(objectId)', instance.objectId), beforeInstanceUpload(entity, instance)).then(this.loadOne);
        };
        Instance.getAndUpdate = function (entity, objectId, updater) {
            return Instance.get(entity, objectId)
                .then(function(loaded) {
                    var updated = updater(loaded);
                    if (updated) {
                        return Instance.put(entity, updated);
                    }
                });

        };
        Instance.delete = function (entity, objectId) {
            return $http.delete(entity.instanceUriTemplate.replace('(objectId)', objectId));
        };
        Instance.post = function (entity, instance) {
            return $http.post(entity.extentUri, beforeInstanceUpload(entity, instance)).then(this.loadOne);
        };
        Instance.getRelated = function (entity, objectId, relationshipName) {
            var relatedInstancesUri = entity.relatedInstancesUriTemplate.replace('(objectId)', objectId).replace('(relationshipName)', relationshipName);
            return $http.get(relatedInstancesUri).then(this.loadMany);
        };
        Instance.getInstanceCapabilities = function (entity, objectId) {
            return $http.get(entity.instanceCapabilityUriTemplate.replace('(objectId)', objectId));
        };
        Instance.getEntityCapabilities = function (entity) {
            return $http.get(entity.entityCapabilityUri);
        };
        Instance.getNewBlobUri = function (entity, propertyName, objectId) {
            var newAttachmentUri = entity.instanceNewBlobUriTemplate.replace('(objectId)', objectId).replace('(propertyName)', propertyName);
            return newAttachmentUri;
        };
        Instance.getBlobUri = function (entity, propertyName, objectId, token) {
            var blobUri = entity.instanceExistingBlobUriTemplate.replace('(objectId)', objectId).replace('(propertyName)', propertyName).replace('(token)', token);
            return blobUri;
        };
        Instance.deleteBlob = function (entity, propertyName, objectId, token) {
            var blobUri = entity.instanceExistingBlobUriTemplate.replace('(objectId)', objectId).replace('(propertyName)', propertyName).replace('(token)', token);
            return $http.delete(blobUri);
        };
        return Instance;
    };
    return serviceFactory;
};

kirraNG.loginController = function($scope, $http, $modalInstance) {
    $scope.ok = function() {
        console.log("Ok pressed");
        $modalInstance.close($scope.credentials);
    };
    $scope.credentials = {};
};


kirraNG.registrationController = function($scope, $http, $modalInstance, $controller, registrationEntity) {
        var entityName = registrationEntity.fullName
        $scope.credentials = { username: "", password: "" };
        $controller(entityName + 'InstanceCreateCtrl', {$scope: $scope});
    $scope.ok = function() {
        console.log("Save pressed");
        var newValues = angular.copy($scope.propertyValues);
        console.log(newValues);
        var newLinks = angular.copy($scope.linkValues);
        var newRepresentation = { values: newValues, links: newLinks };
        console.log("newRepresentation");
        console.log(newRepresentation);
        $modalInstance.close({ instance: newRepresentation, credentials: $scope.credentials });
    };
    $scope.cancel = function() {
            $modalInstance.dismiss();
    };
};


kirraModule = angular.module('kirraModule', ['ui.bootstrap', 'ui.router', 'ui.uploader', 'ui.toggle', 'bootstrapLightbox']);

kirraModule.factory('kirraNotification', function($rootScope) {
    var listeners = [];
    var Notification = function () {
        this.listeners = [];
        angular.extend(this);
    };
    Notification.addListener = function(listener) {
        listeners.push(listener);
    };
    Notification.logError = function(error) {
        angular.forEach(listeners, function(it) {
            it.handleError && it.handleError(error);
        });
    };
    Notification.logInfo = function(info) {
        angular.forEach(listeners, function(it) {
            it.handleInfo && it.handleInfo(info);
        });
    };
    return Notification;
});

kirraModule.service('loginDialog', function($rootScope, $modal, $http, $state, kirraNotification) {
    var LoginDialog = function () {
        angular.extend(this);
    };
    LoginDialog.showing = false;
    LoginDialog.show = function() {
        var dialog = this;
        if (this.showing) {
            return;
        }
        this.showing = true;
        this.modal = $modal.open({
          animation: true,
          templateUrl: kirraGetTemplateUrl('login'),
          controller: 'LoginCtrl'
        });
        this.modal.result.then(function(credentials) {
            dialog.showing = false;
            if (credentials) {
                encodedCredentials = btoa(credentials.username+":"+credentials.password);
                return $http.post(application.uri + 'session/login', {}, { headers: { Authorization: "Custom " + encodedCredentials }});
            }
        }, function() {
            // dismissed? reload in case we were here because the user tried
            // to access a protected resource
            kirraReload();
        }).then(function(loginResponse) {
            if (loginResponse) {
                if (loginResponse.status >= 200 && loginResponse.status < 300) {
                    kirraReload();
                } else {
                    console.log("Error 1!");
                    console.log(errorResponse);
                }
            }
        }, function(errorResponse) {
            kirraNotification.logError(errorResponse);        
        });
    };
    LoginDialog.close = function() {
        if (this.showing && this.modal) {
            this.modal.close();
        }
        this.showing = false;
        delete this.modal;
    };
    return LoginDialog;
});

kirraModule.service('registrationDialog', function($rootScope, $modal, $http, $state) {
    var RegistrationDialog = function () {
        angular.extend(this);
    };
    RegistrationDialog.showing = false;
    RegistrationDialog.show = function(registrationEntity) {
        var dialog = this;
        if (dialog.showing) {
            return;
        }
        var modalConfig = {
            animation: true,
            templateUrl: kirraGetTemplateUrl('registration'),
            controller: 'RegistrationCtrl',
            resolve: {
                registrationEntity: function () {
                  return registrationEntity;
                }
              }
        };
        var showModal;
        showModal = function() {
            dialog.showing = true;
            dialog.modal = $modal.open(modalConfig);
            dialog.modal.result.then(function(modalResult) {
                var instance = modalResult.instance;
                var credentials = modalResult.credentials;
                dialog.showing = false;
                encodedCredentials = btoa(credentials.username+":"+credentials.password);
                return $http.post(application.uri + 'signup/' + registrationEntity.fullName, instance, { headers: { "X-Kirra-Credentials": encodedCredentials }});
            }, function() {
                // dismissed? reload in case we were here because the user tried
                // to access a protected resource
                kirraReload();
            }).then(function(signupResponse) {
                if (signupResponse && signupResponse.status >= 200 && signupResponse.status < 300) {
                    return $http.post(application.uri + 'session/login', {}, { headers: { Authorization: "Custom " + encodedCredentials }})
                        .then(function() {
                            kirraReload(); 
                        }, function() {
                            showModal();
                        });
                } else {
                    showModal();
                }
            }, function() {
                dialog.showing = false;
            });
        };
        showModal();
    };
    RegistrationDialog.close = function() {
        if (this.showing && this.modal) {
            this.modal.close();
        }
        this.showing = false;
        delete this.modal;
    };
    
    return RegistrationDialog;
});

kirraModule.config(function($httpProvider) {
    $httpProvider.interceptors.push(function($q, kirraNotification, $injector) {
        return {
            responseError: function(rejection) {
                if (!rejection.config.ignoreErrors || rejection.config.ignoreErrors.indexOf(rejection.status) < 0) {
                    if (rejection.status == 401) {
                        console.log('Unauthorized: ');
                        console.log(rejection);
                        $injector.get('loginDialog').show();
                    } else {
                        kirraNotification.logError(rejection);
                    }
                }
                // return as rejection or else we are converting an error into a successful outcome
                return $q.reject(rejection);
            }
        };
    });
    $httpProvider.defaults.withCredentials = true;
    $httpProvider.defaults.headers.common["X-Requested-With"] = 'XMLHttpRequest';
    $httpProvider.defaults.headers.common["Cache-control"] = 'no-cache';
});


kirraModule.controller('KirraBaseCtrl', function($scope, kirraNotification) {
    $scope.kirraNG = kirraNG;
    $scope.alerts = [];
    
    $scope.reload =  function() {
        kirraReload();
    };
    
    $scope.goHome = function() {
        kirraReload($scope.applicationUrl);
    };
    
    $scope.addAlert = function(type, message) {
        $scope.alerts.push({type: type, msg: message});
    };

    $scope.closeAlert = function(index) {
        $scope.alerts.splice(index, 1);
    };
    
    $scope.logError = function(error) {
        var message = (error.data && error.data.message) || error.statusText || (typeof error === 'string' && error);
        if (!message) {
            message = "Unexpected error (status code: " + error.status + ")";
        }
        this.addAlert('danger', message);
    };
    
    $scope.clearAlerts = function() {
        $scope.alerts = [];
    };
    
    this.handleError = function(error) {
        $scope.logError(error);
    };
    
    kirraNotification.addListener(this);
});

    
repository.loadApplication(function(loadedApp, status) {
    if (status != 200) {
        console.log(loadedApp);
        kirraModule.controller('KirraRepositoryCtrl', function($scope, kirraNotification) {
            $scope.applicationLabel = "Application not found or not available: " + applicationUrl;
            $scope.entities = [];
            $scope.$root.singletons = {};
            $scope.entityCapabilities = [];
            $scope.applicationOptions = {};
            $scope.smallScreen = window.innerWidth < 768;
        });
        angular.element(document).ready(function() {
          angular.bootstrap(document, ['kirraModule']);
        });
        return;
    }
    application = loadedApp;
    // convert map role name => URI to array of role names
    application.currentUserRoles = angular.equals(application.currentUserRoles, {}) ? ['_NO_ROLES'] : kirraNG.map(application.currentUserRoles, function (uri, role) {
        return role;    
    });
    
    document.title = application.applicationLabel;
     
    
    var buildUI = function(entities, entityCapabilities, status) {
        
        console.log("entities: ");
        console.log(entities);
        console.log("entityCapabilities: ");
        console.log(entityCapabilities);
        
        kirraModule.controller('KirraRepositoryCtrl', function($http, $rootScope, $scope, $state, kirraNotification, instanceService, loginDialog, registrationDialog, applicationService) {
            $scope.applicationLogo = application.applicationLogo;
            $scope.applicationName = application.applicationName;
            $scope.applicationLabel = application.applicationLabel || application.applicationName;
            $scope.$root.singletons = {};
            $scope.currentUser = undefined;
            var anchorlessUri = window.location.href.split(/[#]/)[0]; 
            var uriComponents = anchorlessUri.split(/[?]/);
            var querylessUri = uriComponents[0];
            var query = uriComponents.length > 1 ? uriComponents[1] : "";
            var queryParams = kirraNG.map(query.split(/[&]/), function(nameAndValue) { return nameAndValue.split(/[=]/)});
            var themeParam = kirraNG.find(queryParams, function(nameAndValueAsArray) { return nameAndValueAsArray[0] == 'theme'; });
            var applicationUrl = querylessUri + "?";
            if (!(themeParam === undefined)) {
                    applicationUrl = applicationUrl + "theme=" + themeParam[1];
            }
            applicationUrl = applicationUrl + '&app-uri=' + application.uri;
            
            $scope.applicationUrl = application.viewUri = applicationUrl;
            $scope.entities = entities;
            $scope.entityCapabilitiesByName = entityCapabilitiesByName;
            $scope.entityMenusByName = {};
            angular.forEach(entities, function(entity) {
                var entityCapabilities = entityCapabilitiesByName[entity.fullName];
                var entityMenus = {};
                var queries = entityCapabilities && kirraNG.find(kirraNG.getQueries(entity), function(query) { return entityCapabilities.queries[query.name].indexOf('StaticCall') >= 0; }) ;
                var actions = entityCapabilities && kirraNG.find(kirraNG.getEntityActions(entity), function(action) { return entityCapabilities.actions[action.name].indexOf('StaticCall') >= 0; });
                var creation = entityCapabilities && entity.instantiable && entityCapabilities.entity.indexOf('Create') >= 0;
                $scope.entityMenusByName[entity.fullName] = (queries || actions || creation) ? {
                    queries: Boolean(queries), actions: Boolean(actions), creation: Boolean(creation)
                } : false;
            });
            $scope.reload = function() { 
                $state.go($state.current.name, $state.params, { reload: true }); 
            };
            $scope.performEntityAction = function(entity, action) {
                if (action.parameters.length > 0) {
                    $state.go(kirraNG.toState(entity.fullName, 'performEntityAction'), { actionName: action.name } );
                    return;
                }
                instanceService.performEntityAction(entity, action.name).then(
                    function() {
                        $state.go($state.current.name, $state.params, { reload: true });
                    }
                );
            };
            
            $scope.performInstanceAction = function(action, instance, actionArguments) {
                var entity = entitiesByName[instance.typeRef.fullName];
                if (action.parameters.length > 0 && (!actionArguments || actionArguments.length < action.parameters.length)) {
                    $state.go(kirraNG.toState(entity.fullName, 'performInstanceAction'), { objectId: instance.objectId, actionName: action.name } );
                    return;
                }
                return instanceService.performInstanceAction(entity, instance.objectId, action.name, actionArguments).then($scope.reload);
            };
            
            /** User triggered an action on a related/child object. */
            $scope.performActionOnRelatedInstance = function(relationship, action, relatedObjectId, shorthand, actionArguments) {
                var entity = entitiesByName[relationship.typeRef.fullName];
                if (action.parameters.length > 0 && (actionArguments && actionArguments.length < action.parameters.length)) {
                    $state.go(kirraNG.toState(entity.fullName, 'performInstanceAction'), { objectId: relatedObjectId, actionName: action.name } );
                    return;
                }
                return instanceService.performInstanceAction(entity, relatedObjectId, action.name, actionArguments);
            };

            $scope.performEntityQuery = function(entity, query) {
                $state.go(kirraNG.toState(entity.fullName, 'performQuery'), { 
                    finderName: query.name, 
                    arguments: {} 
                });
            };
            $scope.unfiltered = function(entity, query) {
                $state.go(kirraNG.toState(entity.fullName, 'list'));
            };
            $scope.selfServiceRoleEntities = kirraNG.filter(entities, function(entity) {
                    return entity.role && entityCapabilities[entity.fullName].entity.indexOf('Create') >= 0;
            });
            $scope.applicationOptions = application.options;            
            $scope.kirraNG = kirraNG;
            $scope.currentUser = undefined;
            $scope.currentUserRoles = ['_NO_ROLES'];
//            console.log(entityCapabilities);
            $scope.logout = function() {
                console.log("Logging out");
                encodedCredentials = undefined;
                $http.get(application.uri + "session/logout").then(function(loaded) {
                    kirraReload();
                });
            };
            $scope.login = function() {
               console.log("Log-in requested");
               registrationDialog.close();
               loginDialog.show();
            };
            $scope.registerAs = function(entity) {
               console.log("Sign-up requested");
               loginDialog.close();
               registrationDialog.show(entity);
            };
            
            $scope.getTemplateUrl = function(templateName, hierarchy) {
                return kirraGetTemplateUrl(templateName, hierarchy, $scope.currentUserRoles);    
            };
            
            $scope.getDefaultTemplateUrl = function(templateName) {
                return kirraGetDefaultTemplateUrl(templateName);    
            };
            
            $scope.canChangeTheme = canChangeTheme;
            
            $scope.changeTheme = function(theme) {
                changeTheme(theme);
            };            
            
            $scope.entityLabel = function(entityName) {
                var entity = entitiesByName[entityName];
                return entity ? entity.label : entityName;
            };
            
            $rootScope.$on('applicationLoaded', function(event, application) {
                $scope.currentUserRoles = application.currentUserRoles;
            });
            $rootScope.$on('applicationUserChanged', function(event, application) {
                $scope.currentUser = application.currentUser;
            });
            
            $rootScope.$on('$stateNotFound', 
                function(event, missedState, fromState, fromParams) { 
                    var sourceStateComponents = fromState.name.split(':');
                    var missedStateComponents = missedState.to.split(':');
                    var currentEntityName = sourceStateComponents[0] + '.' + sourceStateComponents[1];
                    var canonicalEntityName = missedStateComponents[0] + '.' + missedStateComponents[1];
                    
                    var entityMappings = kirraGetCustomSettings('', [currentEntityName], 'entityMapping', application.currentUserRoles);
                    if (entityMappings[canonicalEntityName]) {
                        var actualEntityName = entityMappings[canonicalEntityName];
                        var actualEntityNameComponents = actualEntityName.split('.');
                        var customStateNameComponents = angular.copy(missedStateComponents);
                        customStateNameComponents[0] = actualEntityNameComponents[0];
                        customStateNameComponents[1] = actualEntityNameComponents[1];
                        var customStateName = customStateNameComponents.join(":");
                        console.log("Redirecting from " + missedState.to + " to " + customStateName);
                        event.preventDefault();
                        $state.go(customStateName, missedState.toParams, { reload: true });
                    }
                }
            );

            
            // order matters
            applicationService.loadApplication(application);
            
            if (status != 200 || (!application.currentUser && application.options && application.options.isLoginRequired)) {
                loginDialog.show();
            }
            
        });
        
//        kirraModule.directive('lazyScript', function() {
//            return {
//              restrict: 'E',
//              scope: false,
//              link: function(scope, elem, attr) {
//                  var s = document.createElement("script");
//                  s.type = "text/javascript";                
//                  var src = elem.attr('src');
//                  if(src!==undefined) {
//                      s.src = src;
//                  } else {
//                      var code = elem.text();
//                      s.text = code;
//                  }
//                  document.head.appendChild(s);
//                  elem.remove();              }
//            };
//          });

        kirraModule.directive('kaLabel', function($state) {
            return {
                scope: {
                    element: '@',
                    label: '&'
                },                
                link: function (scope, element, attrs) {
                    scope.label = kirraNG.getElementLabel(scope.element, $state.$current.self.name);
                },
                template: '<span>{{label}}</span>'
            };
        });
        
        
        kirraModule.directive('kaSingleton', function(instanceService, instanceViewService, $state, $timeout) {
            return {
                transclude: true,
                scope: {
                    // these are set at the directive call site
                    entityName: '@',
                    queryName: '@',
                    watchedActions: '@',
                    name: '@'
                },                
                link: function (scope, element, attrs, ctrl, transclude) {
                    var name = scope.name;
                    var entityName = scope.entityName;
                    var queryName = scope.queryName;
                    var entity = entitiesByName[entityName];
                    var watchedActions = scope.watchedActions || '';
                    var singleton = { instance: {}, custom: kirraBuildCustomInfo(undefined, entity) };
                    var singletonInstance = singleton.instance;
                    scope.kirraNG = kirraNG;
                    scope.$root.singletons[name] = singleton;
                    var runSingletonQuery = function() {
                        instanceService.performQuery(entity, queryName)
                        .then(function(instances) {
                            var singletonInstance = (instances && instances[0]);
                            scope.listenerKey = instanceService.registerInstanceListener(singletonInstance, instanceLoaded);
                            instanceLoaded(singletonInstance);
                        });
                    };
                    var instanceLoaded = function(singletonInstance) {
                        if (singletonInstance) {
                            angular.merge(singleton.instance, singletonInstance);
                            singleton.objectId = singletonObjectId = singletonInstance.objectId;
                            singleton.singletonStateHref = $state.href(kirraNG.toState(entity.fullName, 'show'), {objectId: singletonInstance.objectId });
                            singleton.custom.loadData(scope.$parent, singletonInstance);
//                            console.log("Debugging singleton!");
//                            console.log(singleton);
//                            console.log(scope.$root.singletons);
                            instanceViewService.loadAllRelatedInstances(singletonInstance, function(instances, relationship) {
                                singleton.custom.loadEdgeData(scope.$parent, instances, relationship)
                            });                        
                        }
                    };
                    angular.forEach(watchedActions.split(','), function(watchedActionName) {
                        var components = watchedActionName.split('.');
                        var actionEntityName = components.slice(0, components.length - 1).join('.');
                        var actionName = components[components.length - 1];
                        instanceService.registerActionListener(actionEntityName, actionName, function() {
                            $timeout(function() {
                                runSingletonQuery();
                            }, 2000, true);
                        });
                    });
                    runSingletonQuery();
                },
                template: '<div style="display: none"></div>'
            };
        });

        
        kirraModule.directive('instanceDetails', [function() {
            return {
                scope: {
                    // these are set at the directive call site
                        embeddedInstanceActions: '=',
                        embeddedInstanceCapabilities: '=',
                        embeddedInstance: '=',
                        embeddedFieldValues: '=',                        
                        embeddedViewFields: '=',
                        embeddedFieldValues: '=',
                        embeddedPerformAction: '&',
                        embeddedObjectId: '=',
                        embeddedEntity: '=',
                        embeddedFieldSelection: '=',
                        embeddedFilterNullValues: '=',
                },
                template: '<div ng-include="templateUrl"></div>',
                link: function (scope) {
                    if (scope.embeddedFieldSelection != undefined) {
                        var selectedViewFields = [];
                        var selectedFieldValues = [];
                        for (var i = scope.embeddedViewFields.length - 1; i >= 0; i--) {
                            var candidate = scope.embeddedViewFields[i];
                            if (!kirraNG.find(scope.embeddedFieldSelection, function(selection) {
                                return selection.name == candidate.name;
                            })) {
                                scope.embeddedViewFields.splice(i, 1);
                                scope.embeddedFieldValues.splice(i, 1);
                            }
                        }
                    }
                    if (scope.embeddedFilterNullValues) {
                        for (var i = scope.embeddedViewFields.length - 1; i >= 0; i--) {
                            if (scope.embeddedFieldValues[i] == null) {
                                scope.embeddedViewFields.splice(i, 1);
                                scope.embeddedFieldValues.splice(i, 1);
                            }
                        }
                    }
                    scope.kirraNG = kirraNG;
                    scope.templateUrl = kirraGetTemplateUrl("embedded-instance", [scope.embeddedEntity.fullName], scope.currentUserRoles);                    
                }
            };
        }]);
        
        kirraModule.directive('instanceActions', [function() {
            return {
                scope: {
                    // these are set at the directive call site
                        embeddedInstanceActions: '=',
                        embeddedInstanceCapabilities: '=',
                        embeddedInstance: '=',
                        embeddedPerformAction: '&',
                        embeddedEntity: '='
                },
                template: '<div ng-include="templateUrl"></div>',
                link: function (scope) {
                    scope.kirraNG = kirraNG;
                    scope.templateUrl = kirraGetTemplateUrl("embedded-instance-actions", [scope.embeddedEntity.fullName], scope.currentUserRoles);                    
                }
            };
        }]);
        
        kirraModule.directive('instanceTable', ['$window', function($window) {
            return {
                    restrict: 'E',
                    template: '<div ng-include="templateUrl"></div>',
                    link: function(scope) {
                        scope.kirraNG = kirraNG;
                        $window.onresize = function() {
                            changeTemplate();
                            scope.$apply();
                        };
                        changeTemplate();
                        
                        function changeTemplate() {
                            var screenWidth = $window.innerWidth;
                            if (screenWidth < 768) {
                                scope.templateUrl = kirraGetTemplateUrl('instance-table-mobile', [scope.entity.fullName], scope.currentUserRoles);
                            } else {
                                scope.templateUrl = kirraGetTemplateUrl('instance-table-desktop', [scope.entity.fullName], scope.currentUserRoles);
                            }
                        }
                    }
            }
        }]);
        
        kirraModule.directive('kaEdit', function(instanceService, kirraNotification, $state) {
            return {
                restrict: 'E',
                scope: {
                    // these are set at the directive call site
                    slot: '=',
                    values: '=',
                    // these are functions
                    findCandidates: '&',
                    formatCandidate: '&'
                },
                link: function (scope, element, attributes) {
                    var slot = scope.slot;
                    var objectId = scope.objectId;
                    var isTable = scope.table;
                    scope.kirraNG = kirraNG;
                    scope.slotTypeName = slot.typeRef.typeName;
                    scope.slotTypeKind = slot.typeRef.kind;
                    scope.onCandidateSelected = function(selectedCandidate) {
                        scope.values[slot.name] = selectedCandidate;
                    };

                    var slotData = scope.values && scope.values[slot.name];
                    if (slot.mnemonic || slot.unique) {
                        if (!isTable && slot.typeRef.kind == 'Entity') {
                            scope.targetObjectId = slotData && slotData.objectId ;
                            scope.targetStateName = kirraNG.toState(slot.typeRef.fullName, 'show');
                        } else if (objectId) {
                            scope.targetObjectId = objectId;
                            scope.targetStateName = kirraNG.toState(slot.owner.fullName, 'show');
                        }
                    } else if (slot.typeRef.kind == 'Entity') {
                        scope.targetObjectId = slotData && slotData.objectId ;
                        scope.targetStateName = kirraNG.toState(slot.typeRef.fullName, 'show');
                    }
                    if (slot.typeRef.typeName == 'Date' || slot.typeRef.typeName == 'DateTime') {
                        scope.togglePickerStatus = function(event) {
                            kirraNG.togglePickerStatus(event, scope, slot.name);
                        };
                    }
                },        
                templateUrl: function(context) {
                    return kirraGetTemplateUrl('ka-edit');
                }
            };
        });

        
        var kaDirectiveFunction = function(uiUploader, instanceService, kirraNotification, $state, $sce, Lightbox) {
            return {
                link: function (scope, element, attributes, controller, transcludeFn) {
                    var slot = scope.slot;
                    if (!slot) {
                        // bad mapping? 
                        return;
                    }
                    var slotData = scope.slotData;
                    var objectId = scope.objectId;
                    var isTable = scope.table;
                    scope.kirraNG = kirraNG;
                    scope.slotTypeName = slot.typeRef.typeName;
                    scope.slotTypeKind = slot.typeRef.kind;
                    
                    if (slot.mnemonic || slot.unique) {
                        if (!isTable && slot.typeRef.kind == 'Entity') {
                            scope.targetObjectId = slotData && slotData.objectId ;
                            scope.targetStateName = kirraNG.toState(slot.typeRef.fullName, 'show');
                        } else if (objectId) {
                            scope.targetObjectId = objectId;
                            scope.targetStateName = kirraNG.toState(slot.owner.fullName, 'show');
                        }
                    } else if (slot.typeRef.kind == 'Entity') {
                        scope.targetObjectId = slotData && slotData.objectId ;
                        scope.targetStateName = kirraNG.toState(slot.typeRef.fullName, 'show');
                        scope.getLinkHref = function() {
                            var href = $state.href(scope.targetStateName, { objectId: scope.targetObjectId });
                            return href;
                        };
                    } else if (slot.typeRef.kind == 'Blob') {
                        element.on('change', function(e) {
                            var fileInput = document.getElementById(slot.name + 'FileInput');
                            var files = fileInput.files;
                            scope.files = files;
                            scope.$apply();
                        });                        
                        scope.attachmentUpload = function(slot, files) {
                            uiUploader.addFiles(files);
                            uiUploader.startUpload({
                                url: instanceService.getNewBlobUri(entitiesByName[slot.owner.fullName], slot.name, objectId  || scope.$parent.$parent.objectId),
                                onProgress: function(file) {
                                    scope.$apply();
                                },
                                onCompleted: function(file, response, status) {
                                    if (status >= 400) {
                                        kirraNotification.logError({ data: JSON.parse(response) });
                                    }
                                    $state.go($state.current.name, $state.params, { reload: true });
                                }
                            });
                        };
                        scope.attachmentCancel = function(slot, slotData, files) {
                            var fileInput = document.getElementById(slot.name + 'FileInput');
                            delete fileInput.files;
                            fileInput.value = '';
                            scope.files = undefined;
                        };
                        scope.attachmentRemove = function(slot, slotData, files) {
                            if (!slotData) {
                                return;
                            }
                            instanceService.deleteBlob(entitiesByName[slot.owner.fullName], slot.name, scope.objectId, slotData.token).then(function() {
                                $state.go($state.current.name, $state.params, { reload: true });
                            });
                        };
                        scope.getAttachmentDownloadUri = function(slot, slotData) {
                            if (!slotData) {
                                return;
                            }
                            return instanceService.getBlobUri(entitiesByName[slot.owner.fullName], slot.name, scope.objectId, slotData.token);
                        };
                        scope.attachmentShow = function (slot, slotData) {
                            if (!slotData) {
                                return;
                            }
                            Lightbox.openModal([{
                                url: this.getAttachmentDownloadUri(slot, slotData)
                            }], 0);
                        };
                    } else if (slot.typeRef.typeName == 'Geolocation') {
                        var marker, map, geocoder, infoWindow, infoWindowContent;

                        var showPlaceDetails = function (place) {
                            var infoWindowZIndex = infoWindow.getZIndex();
                            if (infoWindowZIndex === undefined) {
                                infoWindowContent.children['place-icon'].src = place.icon ? place.icon : "https://maps.gstatic.com/mapfiles/place_api/icons/geocode-71.png";
                                infoWindowContent.children['place-name'].textContent = place.name;
                                infoWindowContent.children['place-address'].textContent = place.formatted_address;
                                infoWindow.open(map, marker);
                            } else {
                                console.log("Skipping");
                            }
                        };
                        /* Show the given location in the map, if set. */
                        var showLocation = function (slot, center, markedLocation, place) {
                            if (center) {
                                map.setCenter(center);
                            }
                            
                            if (marker) {
                                marker.setMap(null);
                            }
                            if (markedLocation) {
                                marker = new google.maps.Marker({
                                    position: markedLocation,
                                    map: map,
                                    title: 'Your location'
                                });
                                
                                if (!place) {
                                    geocoder.geocode({'location': markedLocation}, function(results, status) {
                                        if (status === 'OK') {
                                            if (results[0]) {
                                                showPlaceDetails(results[0]);
                                            }
                                        }
                                    });
                                } else {
                                    if (place.name) {
                                        showPlaceDetails(place);
                                    }
                                }
                                
                            }
                        };

                        angular.element(document).ready(function () {
                            var domElement = document.getElementById(slot.name + 'LiveMap');
                            map = new google.maps.Map(domElement, {
                                center:  { lat: 0, lng: 0 },
                                zoom: 17,
                                disableDefaultUI: true,
                                zoomControl: true,
                                scaleControl: true,
                                clickableLabels:false
                            });
                            var trafficLayer = new google.maps.TrafficLayer();
                            trafficLayer.setMap(map);
                            google.maps.event.addListener(map, 'click', function(event) {
                                setPositionTo(slot, { 
                                    latitude: event.latLng.lat(), 
                                    longitude: event.latLng.lng() 
                                }, false, event.placeId);    
                            });
                            
                            var searchInput = document.getElementById(slot.name + 'MapInput');
                            map.controls[google.maps.ControlPosition.TOP_LEFT].push(searchInput);

                            var autocomplete = new google.maps.places.Autocomplete(searchInput);

                            // Bind the map's bounds (viewport) property to the
                            // autocomplete object,
                            // so that the autocomplete requests use the current
                            // map bounds for the
                            // bounds option in the request.
                            autocomplete.bindTo('bounds', map);
                            
                            geocoder = new google.maps.Geocoder;

                            infoWindow = new google.maps.InfoWindow();
                            infoWindowContent = document.getElementById(slot.name + 'MapInfoPane');
                            infoWindow.setContent(infoWindowContent);

                            autocomplete.addListener('place_changed', function() {
                              infoWindow.close();
                              var place = autocomplete.getPlace();
                              if (!place.geometry) {
                                // User entered the name of a Place that was not
                                // suggested and
                                // pressed the Enter key, or the Place Details
                                // request failed.
                                window.alert("No details available for input: '" + place.name + "'");
                                return;
                              }

                              if (place.geometry.viewport) {
                                map.fitBounds(place.geometry.viewport);
                              }
                              var chosenLocation = place.geometry.location;
                              showLocation(slot, chosenLocation, chosenLocation, place);
                            });
                            
                            var parsedExistingCoords = slotData && slotData.split(/[,]/);
                            if (parsedExistingCoords) {
                                var existingCoords = {
                                    lat: parseFloat(parsedExistingCoords[0]), 
                                    lng: parseFloat(parsedExistingCoords[1])
                                };
                                showLocation(slot, existingCoords, existingCoords);
                            } else {
                                if (navigator.geolocation) {
                                    navigator.geolocation.getCurrentPosition(function(position) {
                                        var myCoords = { 
                                            lat: position.coords.latitude, 
                                            lng: position.coords.longitude
                                        };
                                        showLocation(slot, myCoords);
                                    });
                                }
                            }
                        });
                        scope.generateMapURL = function (slot, slotData) {                            
                            var apiKey = 'AIzaSyBUQJBhKMkuWFXWs695GPI5Wlm22ybONs0';
                            var urlTemplate = "https://www.google.com/maps/embed/v1/place?key={apiKey}&q={geolocation}&zoom=19&maptype=satellite";
                            var url = urlTemplate.replace('{geolocation}', slotData).replace('{apiKey}', apiKey);
                            return $sce.trustAsResourceUrl(url);
                        };
                        scope.getMapAsImageURL =  function (slot, slotData) {
                            var apiKey = 'AIzaSyBUQJBhKMkuWFXWs695GPI5Wlm22ybONs0';
                            var urlTemplate = "https://maps.googleapis.com/maps/api/staticmap?zoom=15&size=300x300&maptype=roadmap&markers={geolocation}&key=AIzaSyBUQJBhKMkuWFXWs695GPI5Wlm22ybONs0";
                            var url = urlTemplate.replace('{geolocation}', slotData).replace('{apiKey}', apiKey);
                            return url; // $sce.trustAsResourceUrl(url);
                        };
                        /*
                         * Update the instance with the given location
                         * (reloading if required)
                         */
                        var setPositionTo = scope.setPositionTo = function(slot, newPosition, reload, placeId) {
                            instanceService.getAndUpdate(entitiesByName[slot.owner.fullName], objectId,
                                function(loaded) {
                                    var newPositionAsString = newPosition && (newPosition.latitude + "," + newPosition.longitude);
                                    loaded.values[slot.name] = newPositionAsString;
                                    return loaded;
                                }
                            ).then(function() {
                                if (reload) {
                                    $state.go($state.current.name, $state.params, { reload: true });
                                } else {
                                    var coords = newPosition ? {
                                        lat: newPosition.latitude, 
                                        lng: newPosition.longitude
                                    } : undefined;

                                    showLocation(slot, undefined, coords, placeId ? {} : undefined);
                                }
                            }).catch(function(error) {
                                console.log("Unexpected error!");
                                kirraNotification.logError(error);
                            });
                        };
                        /*
                         * Clear the current location, removing any location
                         * information.
                         */
                        scope.clearLocation = function (slot) {
                            setPositionTo(slot, null);
                        };
                        /*
                         * Set or replace the current location to be the users'
                         * current location.
                         */
                        scope.setToMyLocation = function (slot, slotData) {
                            if (!navigator.geolocation) {
                                alert("Geolocation is not supported by this browser.");
                                return;
                            }
                            navigator.geolocation.getCurrentPosition(function(position) {
                                setPositionTo(slot, position.coords, false);
                            });
                        };
                    }
                    if (transcludeFn) {
                        transcludeFn(scope, function(clone, scope) {
                            element.append(clone);
                        });
                    }
                }
            };
        };
        
        kirraModule.directive('kaData', function(uiUploader, instanceService, kirraNotification, $state, $sce, Lightbox) {
            var directive = kaDirectiveFunction(uiUploader, instanceService, kirraNotification, $state, $sce, Lightbox);                
            angular.merge(directive, {
                restrict: 'E',
                scope: {
                    // these are set at the directive call site
                    slot: '=',
                    slotData: '=',
                    objectId: '=',
                    table: '=',
                    grid: '=',
                    size: "="
                },
                templateUrl: function(context) {
                    return kirraGetTemplateUrl('ka-data');
                }
            });
            return directive;
        });
            
        kirraModule.directive('kaWrapper', function(uiUploader, instanceService, kirraNotification, $state, $sce, Lightbox) {
            var directive = kaDirectiveFunction(uiUploader, instanceService, kirraNotification, $state, $sce, Lightbox);                
            angular.merge(directive, {
                restrict: 'E',
                transclude: true,
                scope: {
                    // these are set at the directive call site
                    slot: '=',
                    slotData: '=',
                    objectId: '='
                },
                template: '<div style="display: none"></div>'
            });
            return directive;
        });

        kirraModule.controller('DashboardCtrl', kirraNG.buildDashboardController());
        
        angular.forEach(entitiesByName, function (entity, entityName) {
            kirraModule.controller(entityName + 'InstanceShowCtrl', kirraNG.buildInstanceShowController(entity));
            kirraModule.controller(entityName + 'InstanceLinkCtrl', kirraNG.buildInstanceLinkController(entity));                
            kirraModule.controller(entityName + 'InstanceEditCtrl', kirraNG.buildInstanceEditController(entity, 'edit'));
            kirraModule.controller(entityName + 'InstanceCreateCtrl', kirraNG.buildInstanceEditController(entity, 'create'));
            kirraModule.controller(entityName + 'InstanceEditChildCtrl', kirraNG.buildInstanceEditController(entity, 'editChild'));
            kirraModule.controller(entityName + 'InstanceCreateChildCtrl', kirraNG.buildInstanceEditController(entity, 'createChild'));            
            kirraModule.controller(entityName + 'ActionCtrl', kirraNG.buildActionController(entity));
            kirraModule.controller(entityName + 'InstanceListCtrl', kirraNG.buildInstanceListController(entity));
        });
        
        
        kirraModule.controller('LoginCtrl', kirraNG.loginController);
        kirraModule.controller('RegistrationCtrl', kirraNG.registrationController);
        
        kirraModule.factory('instanceService', kirraNG.buildInstanceService());
        kirraModule.factory('instanceViewService', kirraNG.buildInstanceViewService());
        
        kirraModule.factory('applicationService', kirraNG.buildApplicationService());
        
        kirraModule.config(function($stateProvider, $urlRouterProvider) {
            var first = entityNames.find(function(name) { return entitiesByName[name].topLevel });

            $urlRouterProvider.otherwise(function($injector, $location) {
/*                
                var currentUrlComponents = $injector.get('$state').current.url.split('/')
                var targetUrl = $location.url()
                var targetUrlComponents = targetUrl.split('/');
                var currentEntityName = currentUrlComponents[1];
                var canonicalEntityName = targetUrlComponents[1];
                
                var entityMappings = kirraGetCustomSettings('', [currentEntityName], 'entityMapping', application.currentUserRoles);
                if (entityMappings[canonicalEntityName]) {
                    var actualEntityName = entityMappings[canonicalEntityName];
                    var rewrittenUrl = targetUrl.replace(canonicalEntityName);
                    return rewrittenUrl;
                }
*/                
                var found = kirraGetCustomSettings('', undefined, 'views', application.currentUserRoles, function(views) {
                    return views['dashboard'] && views['dashboard'].stateUrl;
                });
                console.log("Current user roles: ");
                console.log(application.currentUserRoles);
                console.log("Custom state URL: " + found);
                var actual = found ? found : '/dashboard/';
                console.log("Actual state URL: " + actual);
                return actual;
            });
            
//            $urlRouterProvider.when('/dashboard/', function($match) {
//                var injector = angular.element(document.body).injector();
//                var applicationService = injector.get('applicationService');
//                var found = kirraGetCustomSettings('dashboard', undefined, 'state', applicationService.currentUserRoles);
//                if (found) {
//                    
//                }
//                return found ? found : '/dashboard/';
//            });
            
            
            var hideDashboard = kirraGetCustomSettings('dashboard', undefined, 'hide', application.currentUserRoles);
            if (!hideDashboard) {
                $stateProvider.state('dashboard', {
                    url: "/dashboard/",
                    controller: 'DashboardCtrl',
                    templateUrl: function(context) {
                        var dashboardTemplateUrl = kirraGetTemplateUrl('dashboard', undefined, application.currentUserRoles);
                        console.log("Hitting dashboard state: " + dashboardTemplateUrl);
                        return dashboardTemplateUrl;
                    }                
                });
            }

            console.log("Building states for entities");
            console.log(entityNames);
            angular.forEach(entityNames, function(entityName) {
                var entity = entitiesByName[entityName];
                $stateProvider.state(kirraNG.toState(entityName, 'list'), {
                    url: "/" + entityName + "/",
                    controller: entityName + 'InstanceListCtrl',
                    templateUrl: function(context) {
                        return kirraGetTemplateUrl('instance-list', [entityName], application.currentUserRoles);
                    }
                });
                $stateProvider.state(kirraNG.toState(entityName, 'show'), {
                    url: "/" + entityName + "/:objectId/show",
                    controller: entityName + 'InstanceShowCtrl',
                    templateUrl: function(context) {
                        return kirraGetTemplateUrl('show-instance', [entityName], application.currentUserRoles);
                    },
                    params: { objectId: { value: undefined } }
                });
                $stateProvider.state(kirraNG.toState(entityName, 'edit'), {
                    url: "/" + entityName + "/:objectId/edit",
                    controller: entityName + 'InstanceEditCtrl',
                    templateUrl: function(context) {
                        return kirraGetTemplateUrl('edit-instance', [entityName], application.currentUserRoles);
                    },
                    params: { objectId: { value: undefined } }
                });
                $stateProvider.state(kirraNG.toState(entityName, 'create'), {
                    url: "/" + entityName + "/create",
                    controller: entityName + 'InstanceCreateCtrl',
                    templateUrl: function(context) {
                        return kirraGetTemplateUrl('edit-instance', [entityName], application.currentUserRoles);
                    }
                });
                $stateProvider.state(kirraNG.toState(entityName, 'editChild'), {
                    url: "/" + entityName + "/:objectId/editChild/:relationshipName/:childObjectId",
                    controller: entityName + 'InstanceEditChildCtrl',
                    templateUrl: function(context) {
                        return kirraGetTemplateUrl('edit-instance', [entityName, context.relationshipName], application.currentUserRoles);
                    },                    
                    params: { childObjectId: { value: undefined }, objectId: { value: undefined }, relationshipName: { value: undefined } }
                });
                $stateProvider.state(kirraNG.toState(entityName, 'createChild'), {
                    url: "/" + entityName + "/:objectId/createChild/:relationshipName/as/:relatedEntity",
                    controller: entityName + 'InstanceCreateChildCtrl',
                    templateUrl: function(context) {
                        return kirraGetTemplateUrl('edit-instance', [entityName, context.relationshipName, context.relatedEntity], application.currentUserRoles);
                    },                    
                    params: { objectId: { value: undefined }, relationshipName: { value: undefined } }
                });                
                $stateProvider.state(kirraNG.toState(entityName, 'performInstanceAction'), {
                    url: "/" + entityName + "/:objectId/perform/:actionName",
                    controller: entityName + 'ActionCtrl',
                    templateUrl: function(context) {
                        return kirraGetTemplateUrl('execute-action', [entityName, context.actionName], application.currentUserRoles);
                    },                    
                    params: { objectId: { value: undefined }, actionName: { value: undefined } }
                });                
                $stateProvider.state(kirraNG.toState(entityName, 'performEntityAction'), {
                    url: "/" + entityName + "/perform/:actionName",
                    controller: entityName + 'ActionCtrl',
                    templateUrl: function(context) {
                        return kirraGetTemplateUrl('execute-action', [entityName, context.actionName], application.currentUserRoles);
                    },
                    params: { actionName: { value: undefined } }
                });                
                $stateProvider.state(kirraNG.toState(entityName, 'performQuery'), {
                    url: "/" + entityName + "/finder/:finderName",
                    controller: entityName + 'InstanceListCtrl',
                    templateUrl: function(context) {
                        return kirraGetTemplateUrl('instance-list', [entityName, context.finderName], application.currentUserRoles);
                    },                    
                    params: { finderName: { value: undefined }, arguments: { value: undefined }, forceFetch: { value: false } }
                });
            }); 

        });
        
        angular.element(document).ready(function() {
            angular.bootstrap(document, ['kirraModule']);
            kirraLoadLazyScripts();
        });
    };
    
    repository.loadEntities(function(loadedEntities) {
        entitiesByName = {};
        entityCapabilitiesByName = {};
        entityNames = [];
        entities = loadedEntities;
        
        angular.forEach(loadedEntities, function(entity) {
            entitiesByName[entity.fullName] = entity;
            entityCapabilitiesByName[entity.fullName] = {};
            entityNames.push(entity.fullName);
        });
        
        repository.loadEntityCapabilities(function(loadedEntityCapabilities, status) {
            if (status == 200) {
                entityCapabilitiesByName = loadedEntityCapabilities;
                angular.forEach(entityCapabilitiesByName, function(capabilities, entityName) {
                    var actualAccessibleQuery = kirraNG.find(capabilities.queries, function (queryCaps, queryName) {
                        var query = entitiesByName[entityName].operations[queryName]; 
                        return queryCaps.length && query.typeRef.kind == "Entity";
                    });
                    if (capabilities.entity.indexOf('List') < 0 && (!Object.keys(capabilities.queries).length || !actualAccessibleQuery)) {
                        entitiesByName[entityName].forbidden = true;
                    }
                });
                buildUI(loadedEntities, loadedEntityCapabilities, status);
            } else {
                buildUI(loadedEntities, {}, status);
            }
        });
    });    
});                


// workaround for twbs/bootstrap#12852
$(document).on('click','.navbar-collapse.in',function(e) {
    if( $(e.target).is('a') && ( $(e.target).attr('class') != 'dropdown-toggle' ) ) {
        $(this).collapse('hide');
    }
});