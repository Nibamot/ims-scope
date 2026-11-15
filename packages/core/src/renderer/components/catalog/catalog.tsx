/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Copyright (c) OpenLens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { Button } from "@nibamot/button";
import { Icon } from "@nibamot/icon";
import { loggerInjectionToken } from "@nibamot/logger";
import { showErrorNotificationInjectable } from "@nibamot/notifications";
import { withInjectables } from "@ogre-tools/injectable-react";
import { action, comparer, makeObservable, observable, reaction, runInAction, when } from "mobx";
import { observer } from "mobx-react";
import React from "react";
import emitAppEventInjectable from "../../../common/app-event-bus/emit-event.injectable";
import catalogCategoryRegistryInjectable from "../../../common/catalog/category-registry.injectable";
import visitEntityContextMenuInjectable from "../../../common/catalog/visit-entity-context-menu.injectable";
import {
  isKubernetesCluster,
  KubernetesCluster,
  LensKubernetesClusterStatus,
} from "../../../common/catalog-entities/kubernetes-cluster";
import navigateToCatalogInjectable from "../../../common/front-end-routing/routes/catalog/navigate-to-catalog.injectable";
import activeHotbarInjectable from "../../../features/hotbar/storage/common/active.injectable";
import normalizeCatalogEntityContextMenuInjectable from "../../catalog/normalize-menu-item.injectable";
import navigateInjectable from "../../navigation/navigate.injectable";
import { ItemListLayout } from "../item-object-list";
import { MainLayout } from "../layout/main-layout";
import { MenuActions, MenuItem } from "../menu";
import { RenderDelay } from "../render-delay/render-delay";
import styles from "./catalog.module.scss";
import { CatalogAddButton } from "./catalog-add-button";
import { browseCatalogTab } from "./catalog-browse-tab";
import catalogEntityStoreInjectable from "./catalog-entity-store.injectable";
import { CatalogMenu } from "./catalog-menu";
import catalogPreviousActiveTabStorageInjectable from "./catalog-previous-active-tab-storage/catalog-previous-active-tab-storage.injectable";
import catalogRouteParametersInjectable from "./catalog-route-parameters.injectable";
import getCategoryColumnsInjectable from "./columns/get.injectable";
import customCategoryViewsInjectable from "./custom-views.injectable";
import onCatalogEntityListClickInjectable from "./entity-details/on-catalog-click.injectable";
import showEntityDetailsInjectable from "./entity-details/show.injectable";
import { HotbarToggleMenuItem } from "./hotbar-toggle-menu-item";

import type { Logger } from "@nibamot/logger";
import type { ShowNotification } from "@nibamot/notifications";

import type { IComputedValue } from "mobx";

import type { EmitAppEvent } from "../../../common/app-event-bus/emit-event.injectable";
import type { CatalogCategory, CatalogCategoryRegistry, CatalogEntity } from "../../../common/catalog";
import type { VisitEntityContextMenu } from "../../../common/catalog/visit-entity-context-menu.injectable";
import type { NavigateToCatalog } from "../../../common/front-end-routing/routes/catalog/navigate-to-catalog.injectable";
import type { Hotbar } from "../../../features/hotbar/storage/common/hotbar";
import type { CatalogEntityContextMenu } from "../../api/catalog-entity";
import type { NormalizeCatalogEntityContextMenu } from "../../catalog/normalize-menu-item.injectable";
import type { Navigate } from "../../navigation/navigate.injectable";
import type { StorageLayer } from "../../utils/storage-helper";
import type { CatalogEntityStore } from "./catalog-entity-store.injectable";
import type { CategoryColumns, GetCategoryColumnsParams } from "./columns/get.injectable";
import type { CustomCategoryViewComponents } from "./custom-views";
import type { RegisteredCustomCategoryViewDecl } from "./custom-views.injectable";
import type { OnCatalogEntityListClick } from "./entity-details/on-catalog-click.injectable";
import type { ShowEntityDetails } from "./entity-details/show.injectable";

interface Dependencies {
  catalogPreviousActiveTabStorage: StorageLayer<string | null>;
  catalogEntityStore: CatalogEntityStore;
  getCategoryColumns: (params: GetCategoryColumnsParams) => CategoryColumns;
  customCategoryViews: IComputedValue<Map<string, Map<string, RegisteredCustomCategoryViewDecl>>>;
  emitEvent: EmitAppEvent;
  showEntityDetails: ShowEntityDetails;
  onCatalogEntityListClick: OnCatalogEntityListClick;
  routeParameters: {
    group: IComputedValue<string>;
    kind: IComputedValue<string>;
  };
  navigateToCatalog: NavigateToCatalog;
  catalogCategoryRegistry: CatalogCategoryRegistry;
  visitEntityContextMenu: VisitEntityContextMenu;
  navigate: Navigate;
  normalizeMenuItem: NormalizeCatalogEntityContextMenu;
  showErrorNotification: ShowNotification;
  logger: Logger;
  activeHotbar: IComputedValue<Hotbar | undefined>;
}

@observer
class NonInjectedCatalog extends React.Component<Dependencies> {
  private readonly disposers: (() => void)[] = [];
  private readonly menuItems = observable.array<CatalogEntityContextMenu>();
  @observable activeTab: string | undefined = undefined;

  // mobx-react 9 forbids reading this.props inside a derivation. renderItemMenu is
  // invoked from the ItemListLayout row renderer — a derivation other than this
  // component's own render — so it reads props from this observable snapshot,
  // refreshed on every update, instead of this.props.
  @observable.ref private observableProps: Readonly<Dependencies>;

  constructor(props: Dependencies) {
    super(props);
    this.observableProps = props;
    makeObservable(this);
  }

  componentDidUpdate() {
    // Skip equal copies: React 19 can hand a class a fresh props object on a
    // self-triggered render, and replacing the snapshot with one would
    // re-trigger every render reading it.
    if (!comparer.shallow(this.observableProps, this.props)) {
      this.observableProps = this.props;
    }
  }

  async componentDidMount() {
    const {
      catalogEntityStore,
      catalogPreviousActiveTabStorage,
      catalogCategoryRegistry,
      logger,
      showErrorNotification,
      routeParameters,
    } = this.props;

    // Capture props before the reaction: mobx-react 9 forbids reading this.props
    // inside a derivation. Recompute routeActiveTab from the captured observables so
    // the reaction's data function no longer touches this.props.
    const routeActiveTab = (): string => {
      const dereferencedGroup = routeParameters.group.get();
      const dereferencedKind = routeParameters.kind.get();

      if (dereferencedGroup && dereferencedKind) {
        return `${dereferencedGroup}/${dereferencedKind}`;
      }

      return catalogPreviousActiveTabStorage.get() || browseCatalogTab;
    };

    this.disposers.push(
      catalogEntityStore.watch(),
      reaction(
        () => routeActiveTab(),
        async (routeTab) => {
          catalogPreviousActiveTabStorage.set(routeTab);

          try {
            if (routeTab !== browseCatalogTab) {
              // we need to wait because extensions might take a while to load
              await when(() => Boolean(catalogCategoryRegistry.filteredItems.find((i) => i.getId() === routeTab)), {
                timeout: 5_000,
              });
            }

            const item = catalogCategoryRegistry.filteredItems.find((i) => i.getId() === routeTab);

            runInAction(() => {
              this.activeTab = routeTab;
              catalogEntityStore.activeCategory.set(item);
            });
          } catch (error) {
            logger.warn("Failed to find route tab", error);
            showErrorNotification(
              <p>
                {"Unknown category: "}
                {routeTab}
              </p>,
            );
          }
        },
        { fireImmediately: true },
      ),
      // If active category is filtered out, automatically switch to the first category
      reaction(
        () => [...catalogCategoryRegistry.filteredItems],
        (categories) => {
          const currentCategory = catalogEntityStore.activeCategory.get();
          const someCategory = categories[0];

          if (routeActiveTab() === browseCatalogTab || !someCategory) {
            return;
          }

          const currentCategoryShouldBeShown = Boolean(
            categories.find((item) => item.getId() === someCategory.getId()),
          );

          if (!currentCategory || !currentCategoryShouldBeShown) {
            this.activeTab = someCategory.getId();
            catalogEntityStore.activeCategory.set(someCategory);
          }
        },
      ),
    );

    this.props.emitEvent({
      name: "catalog",
      action: "open",
    });
  }

  componentWillUnmount() {
    this.disposers.forEach((dispose) => dispose());
  }

  addToHotbar(entity: CatalogEntity): void {
    this.props.activeHotbar.get()?.addEntity(entity);
  }

  removeFromHotbar(entity: CatalogEntity): void {
    this.props.activeHotbar.get()?.removeEntity(entity.getId());
  }

  private getSelectedClusters(): KubernetesCluster[] {
    const { catalogEntityStore } = this.props;

    return catalogEntityStore.pickOnlySelected(catalogEntityStore.entities.get()).filter(isKubernetesCluster);
  }

  connectSelectedClusters = async () => {
    const clusters = this.getSelectedClusters().filter(
      (cluster) => cluster.status.phase === LensKubernetesClusterStatus.DISCONNECTED,
    );

    await Promise.all(clusters.map((cluster) => cluster.connect()));
  };

  disconnectSelectedClusters = async () => {
    const clusters = this.getSelectedClusters().filter(
      (cluster) =>
        cluster.status.phase === LensKubernetesClusterStatus.CONNECTED ||
        cluster.status.phase === LensKubernetesClusterStatus.CONNECTING,
    );

    await Promise.all(clusters.map((cluster) => cluster.disconnect()));
  };

  onTabChange = action((tabId: string | null) => {
    const activeCategory = tabId ? this.props.catalogCategoryRegistry.getById(tabId) : undefined;

    this.props.emitEvent({
      name: "catalog",
      action: "change-category",
      params: {
        category: activeCategory?.getName() ?? "Browse",
      },
    });

    if (activeCategory) {
      this.props.catalogPreviousActiveTabStorage.set(`${activeCategory.spec.group}/${activeCategory.spec.names.kind}`);
      this.props.navigateToCatalog({ group: activeCategory.spec.group, kind: activeCategory.spec.names.kind });
    } else {
      this.props.catalogPreviousActiveTabStorage.set(null);
      this.props.navigateToCatalog({ group: browseCatalogTab });
    }
  });

  renderItemMenu = (entity: CatalogEntity) => {
    // Called from the ItemListLayout row renderer (a foreign derivation), so read
    // props from the observable snapshot instead of this.props (mobx-react 9).
    const { visitEntityContextMenu, navigate, normalizeMenuItem, showEntityDetails } = this.observableProps;

    const onOpen = () => {
      this.menuItems.clear();
      visitEntityContextMenu(entity, {
        menuItems: this.menuItems,
        navigate,
      });
    };

    return (
      <MenuActions
        id={`menu-actions-for-catalog-for-${entity.getId()}`}
        data-testid={`menu-actions-for-catalog-for-${entity.getId()}`}
        onOpen={onOpen}
      >
        <MenuItem
          key="open-details"
          data-testid={`open-details-menu-item-for-${entity.getId()}`}
          onClick={() => showEntityDetails(entity.getId())}
        >
          View Details
        </MenuItem>
        {this.menuItems.map(normalizeMenuItem).map((menuItem, index) => (
          <MenuItem key={index} onClick={menuItem.onClick}>
            {menuItem.title}
          </MenuItem>
        ))}
        <HotbarToggleMenuItem
          key="hotbar-toggle"
          entity={entity}
          addContent="Add to Hotbar"
          removeContent="Remove from Hotbar"
        />
      </MenuActions>
    );
  };

  renderViews = (activeCategory: CatalogCategory | undefined) => {
    if (!activeCategory) {
      return this.renderList(undefined);
    }

    const customViews = this.props.customCategoryViews
      .get()
      .get(activeCategory.spec.group)
      ?.get(activeCategory.spec.names.kind);
    const renderView = ({ View }: CustomCategoryViewComponents, index: number) => (
      <View key={index} category={activeCategory} />
    );

    return (
      <>
        {customViews?.before.map(renderView)}
        {this.renderList(activeCategory)}
        {customViews?.after.map(renderView)}
      </>
    );
  };

  renderList(activeCategory: CatalogCategory | undefined) {
    const { catalogEntityStore, getCategoryColumns } = this.props;
    const tableId = activeCategory ? `catalog-items-${activeCategory.metadata.name.replace(" ", "")}` : "catalog-items";

    if (this.activeTab === undefined) {
      return null;
    }

    // Bulk connect/disconnect/remove only make sense for a single kind of
    // entity with well-defined semantics, so this is scoped to the Clusters
    // category tab rather than every catalog entity kind.
    const isClusterCategory = activeCategory?.spec.names.kind === KubernetesCluster.kind;
    const selectedClusters = isClusterCategory ? this.getSelectedClusters() : [];
    const hasDisconnected = selectedClusters.some(
      (cluster) => cluster.status.phase === LensKubernetesClusterStatus.DISCONNECTED,
    );
    const hasConnected = selectedClusters.some(
      (cluster) =>
        cluster.status.phase === LensKubernetesClusterStatus.CONNECTED ||
        cluster.status.phase === LensKubernetesClusterStatus.CONNECTING,
    );

    return (
      <ItemListLayout<CatalogEntity, false>
        className={styles.Catalog}
        tableId={tableId}
        renderHeaderTitle={activeCategory?.metadata.name ?? "Browse All"}
        isSelectable={isClusterCategory}
        isConfigurable={true}
        preloadStores={false}
        store={catalogEntityStore}
        getItems={() => catalogEntityStore.entities.get()}
        customizeTableRowProps={(entity) => ({
          disabled: !entity.isEnabled(),
        })}
        {...getCategoryColumns({ activeCategory })}
        onDetails={this.props.onCatalogEntityListClick}
        renderItemMenu={this.renderItemMenu}
        tableProps={{
          customRowHeights: () => 36, // Entity avatar size + padding
        }}
        data-testid={`catalog-list-for-${activeCategory?.metadata.name ?? "browse-all"}`}
        {...(isClusterCategory
          ? {
              customizeRemoveDialog: (selected: CatalogEntity[]) => ({
                labelOk: "Remove",
                message: (
                  <p>
                    {"Disconnect and remove "}
                    <b>{selected.length}</b>
                    {selected.length === 1 ? " cluster" : " clusters"}
                    {" from IMS-Scope? The underlying kubeconfig file is not changed."}
                  </p>
                ),
              }),
              addRemoveButtons: {
                className: styles.clusterBulkActions,
                removeTooltip: `Disconnect & remove selected clusters (${selectedClusters.length})`,
                extraButtons: [
                  hasDisconnected && (
                    <Button
                      key="connect-selected"
                      big
                      round
                      primary
                      onClick={this.connectSelectedClusters}
                      tooltip={`Connect selected clusters (${selectedClusters.length})`}
                    >
                      <Icon material="link" />
                    </Button>
                  ),
                  hasConnected && (
                    <Button
                      key="disconnect-selected"
                      big
                      round
                      primary
                      onClick={this.disconnectSelectedClusters}
                      tooltip={`Disconnect selected clusters (${selectedClusters.length})`}
                    >
                      <Icon material="link_off" />
                    </Button>
                  ),
                ].filter(Boolean),
              },
            }
          : {})}
      />
    );
  }

  render() {
    const activeCategory = this.props.catalogEntityStore.activeCategory.get();

    return (
      <MainLayout sidebar={<CatalogMenu activeTab={this.activeTab} onItemClick={this.onTabChange} />}>
        <div className={styles.views}>{this.renderViews(activeCategory)}</div>
        {activeCategory ? (
          <RenderDelay>
            <CatalogAddButton category={activeCategory} />
          </RenderDelay>
        ) : null}
      </MainLayout>
    );
  }
}

export const Catalog = withInjectables<Dependencies>(NonInjectedCatalog, {
  getProps: (di, props) => ({
    ...props,
    catalogEntityStore: di.inject(catalogEntityStoreInjectable),
    catalogPreviousActiveTabStorage: di.inject(catalogPreviousActiveTabStorageInjectable),
    getCategoryColumns: di.inject(getCategoryColumnsInjectable),
    customCategoryViews: di.inject(customCategoryViewsInjectable),
    routeParameters: di.inject(catalogRouteParametersInjectable),
    navigateToCatalog: di.inject(navigateToCatalogInjectable),
    emitEvent: di.inject(emitAppEventInjectable),
    activeHotbar: di.inject(activeHotbarInjectable),
    catalogCategoryRegistry: di.inject(catalogCategoryRegistryInjectable),
    visitEntityContextMenu: di.inject(visitEntityContextMenuInjectable),
    navigate: di.inject(navigateInjectable),
    normalizeMenuItem: di.inject(normalizeCatalogEntityContextMenuInjectable),
    logger: di.inject(loggerInjectionToken),
    showErrorNotification: di.inject(showErrorNotificationInjectable),
    showEntityDetails: di.inject(showEntityDetailsInjectable),
    onCatalogEntityListClick: di.inject(onCatalogEntityListClickInjectable),
  }),
});
