import { create } from 'zustand'
import { IProvider } from '@/types'
import {
  addProvider,
  getProviderById,
  getProviderList,
  updateProviderById,
} from '@/services/model.ts'

interface ProviderStore {
  provider: IProvider[]
  setProvider: (provider: IProvider) => void
  setAllProviders: (providers: IProvider[]) => void
  getProviderById: (id: string) => IProvider | undefined
  getProviderList: () => IProvider[]
  fetchProviderList: () => Promise<void>
  loadProviderById: (id: string) => Promise<IProvider>
  addNewProvider: (
    provider: Pick<IProvider, 'name' | 'apiKey' | 'baseUrl' | 'type'>
  ) => Promise<string>
  updateProvider: (provider: Partial<IProvider> & Pick<IProvider, 'id'>) => Promise<void>
}

export const useProviderStore = create<ProviderStore>((set, get) => ({
  provider: [],

  // 添加或更新一个 provider
  setProvider: newProvider =>
    set(state => {
      const exists = state.provider.find(p => p.id === newProvider.id)
      if (exists) {
        return {
          provider: state.provider.map(p => (p.id === newProvider.id ? newProvider : p)),
        }
      } else {
        return { provider: [...state.provider, newProvider] }
      }
    }),

  // 设置整个 provider 列表
  setAllProviders: providers => set({ provider: providers }),
  loadProviderById: async (id: string) => {
    const item = await getProviderById(id)
    const provider = {
      id: item.id,
      name: item.name,
      logo: item.logo,
      apiKey: item.api_key,
      baseUrl: item.base_url,
      type: item.type,
      enabled: item.enabled,
    }
    get().setProvider(provider)
    return provider
  },
  addNewProvider: async provider => {
    const payload = {
      name: provider.name,
      type: provider.type,
      logo: provider.type === 'cli' ? 'cli' : 'custom',
      api_key: provider.apiKey,
      base_url: provider.baseUrl,
    }
    const id = await addProvider(payload)
    if (typeof id !== 'string' || !id) throw new Error('新增供应商未返回 ID')
    await get().fetchProviderList()
    return id
  },
  // 按 id 获取单个 provider
  getProviderById: id => get().provider.find(p => p.id === id),
  updateProvider: async provider => {
    const existing = get().provider.find(p => p.id === provider.id)
    if (!existing) throw new Error(`供应商不存在: ${provider.id}`)
    const merged = { ...existing, ...provider }

    await updateProviderById({
      id: merged.id,
      name: merged.name,
      logo: merged.logo,
      type: merged.type,
      enabled: merged.enabled,
      api_key: merged.apiKey,
      base_url: merged.baseUrl,
    })
    await get().fetchProviderList()
  },
  getProviderList: () => get().provider,
  fetchProviderList: async () => {
    try {
      const res = await getProviderList()

      set({
        provider: res.map(
          (item: {
            id: string
            name: string
            logo: string
            api_key: string
            base_url: string
            type: string
            enabled: number
          }) => {
            return {
              id: item.id,
              name: item.name,
              logo: item.logo,
              apiKey: item.api_key,
              baseUrl: item.base_url,
              type: item.type,
              enabled: item.enabled,
            }
          }
        ),
      })
    } catch (error) {
      console.error('Error fetching provider list:', error)
    }
  },
}))
