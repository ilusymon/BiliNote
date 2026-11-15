import { zodResolver } from '@hookform/resolvers/zod'
import { X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import toast from 'react-hot-toast'
import { useNavigate, useParams } from 'react-router-dom'
import { z } from 'zod'

import { ModelSelector } from '@/components/Form/modelForm/ModelSelector'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { deleteModelById, getLocalCliList, testConnection } from '@/services/model'
import { useModelStore } from '@/store/modelStore'
import { useProviderStore } from '@/store/providerStore'

const ProviderSchema = z
  .object({
    name: z.string().min(2, '名称不能少于 2 个字符'),
    apiKey: z.string().optional(),
    baseUrl: z.string().min(1, '此项不能为空'),
    type: z.enum(['built-in', 'custom', 'cli']),
  })
  .superRefine((values, context) => {
    if (values.type === 'cli') return
    try {
      const url = new URL(values.baseUrl)
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error()
    } catch {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: '必须是合法的 HTTP(S) URL',
        path: ['baseUrl'],
      })
    }
  })

type ProviderFormValues = z.infer<typeof ProviderSchema>
type SavedModel = { id: number; model_name: string }

const TYPE_LABELS: Record<ProviderFormValues['type'], string> = {
  'built-in': '内置供应商',
  custom: 'OpenAI 兼容 API',
  cli: '本地 CLI',
}

const ProviderForm = ({ isCreate = false }: { isCreate?: boolean }) => {
  const { id } = useParams()
  const navigate = useNavigate()
  const loadProviderById = useProviderStore(state => state.loadProviderById)
  const updateProvider = useProviderStore(state => state.updateProvider)
  const addNewProvider = useProviderStore(state => state.addNewProvider)
  const loadModelsById = useModelStore(state => state.loadModelsById)
  const [loading, setLoading] = useState(true)
  const [testing, setTesting] = useState(false)
  const [models, setModels] = useState<SavedModel[]>([])
  const [localClis, setLocalClis] = useState<{ id: string; name: string }[]>([])

  const providerForm = useForm<ProviderFormValues>({
    resolver: zodResolver(ProviderSchema),
    defaultValues: { name: '', apiKey: '', baseUrl: '', type: 'custom' },
  })
  const providerType = providerForm.watch('type')
  const isBuiltIn = providerType === 'built-in'
  const isCli = providerType === 'cli'

  useEffect(() => {
    if (!isCli) return
    getLocalCliList().then(items => {
      setLocalClis(items)
      if (!id) {
        providerForm.setValue('baseUrl', items[0]?.id ?? '', { shouldDirty: true })
      }
    })
  }, [id, isCli, providerForm])

  const refreshModels = async (providerId = id) => {
    if (!providerId) return
    setModels(await loadModelsById(providerId))
  }

  useEffect(() => {
    const load = async () => {
      try {
        if (!isCreate && id) {
          const provider = await loadProviderById(id)
          providerForm.reset(provider)
          setModels(await loadModelsById(id))
        }
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [id, isCreate, loadModelsById, loadProviderById, providerForm])

  const handleDelete = async (modelId: number) => {
    if (!window.confirm('确定要删除这个模型吗？')) return
    try {
      await deleteModelById(modelId)
      await refreshModels()
      toast.success('删除成功')
    } catch {
      toast.error('删除异常')
    }
  }

  const handleTest = async () => {
    const values = providerForm.getValues()
    if (!id) {
      toast.error('请先保存供应商信息并添加模型')
      return
    }
    if (providerForm.formState.isDirty) {
      toast.error('请先保存当前修改')
      return
    }
    if (!values.baseUrl || (!isCli && !values.apiKey)) {
      toast.error(isCli ? '请选择本地 CLI' : '请填写 API Key 和 API 地址')
      return
    }
    try {
      setTesting(true)
      await testConnection({ id }, { silent: true })
      toast.success('测试连通性成功 🎉')
    } catch (error) {
      const message =
        typeof error === 'object' && error && 'msg' in error ? String(error.msg) : '未知错误'
      toast.error(`连接失败: ${message}`)
    } finally {
      setTesting(false)
    }
  }

  const onProviderSubmit = async (values: ProviderFormValues) => {
    if (id) {
      await updateProvider({ ...values, id })
      providerForm.reset(values)
      toast.success('更新供应商成功')
      return
    }

    const providerId = await addNewProvider(values)
    toast.success('新增供应商成功')
    navigate(`/settings/model/${providerId}`)
  }

  if (loading) return <div className="p-4">加载中...</div>

  return (
    <div className="flex flex-col gap-8 p-4">
      <Form {...providerForm}>
        <form
          onSubmit={providerForm.handleSubmit(onProviderSubmit)}
          className="flex max-w-2xl flex-col gap-4"
        >
          <div className="text-lg font-bold">{id ? '编辑模型供应商' : '新增模型供应商'}</div>

          {isCli ? (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              自动检测后端所在机器已安装的 CLI。当前仅支持文本输入。
            </div>
          ) : !isBuiltIn ? (
            <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
              自定义模型供应商需要兼容 OpenAI API。
            </div>
          ) : null}

          <FormField
            control={providerForm.control}
            name="name"
            render={({ field }) => (
              <FormItem className="grid grid-cols-1 gap-2 sm:grid-cols-[6rem_minmax(0,1fr)] sm:items-center sm:gap-4">
                <FormLabel className="sm:text-right">名称</FormLabel>
                <FormControl>
                  <Input {...field} disabled={isBuiltIn} />
                </FormControl>
                <FormMessage className="sm:col-start-2" />
              </FormItem>
            )}
          />

          <FormField
            control={providerForm.control}
            name="type"
            render={({ field }) => (
              <FormItem className="grid grid-cols-1 gap-2 sm:grid-cols-[6rem_minmax(0,1fr)] sm:items-center sm:gap-4">
                <FormLabel className="sm:text-right">类型</FormLabel>
                {id ? (
                  <Input value={TYPE_LABELS[field.value]} disabled />
                ) : (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="custom">OpenAI 兼容 API</SelectItem>
                      <SelectItem value="cli">本地 CLI</SelectItem>
                    </SelectContent>
                  </Select>
                )}
                <FormMessage className="sm:col-start-2" />
              </FormItem>
            )}
          />

          {!isCli && (
            <FormField
              control={providerForm.control}
              name="apiKey"
              render={({ field }) => (
                <FormItem className="grid grid-cols-1 gap-2 sm:grid-cols-[6rem_minmax(0,1fr)] sm:items-center sm:gap-4">
                  <FormLabel className="sm:text-right">API Key</FormLabel>
                  <FormControl>
                    <Input {...field} type="password" autoComplete="off" />
                  </FormControl>
                  <FormMessage className="sm:col-start-2" />
                </FormItem>
              )}
            />
          )}

          <FormField
            control={providerForm.control}
            name="baseUrl"
            render={({ field }) => (
              <FormItem className="grid grid-cols-1 gap-2 sm:grid-cols-[6rem_minmax(0,1fr)_auto] sm:items-center sm:gap-4">
                <FormLabel className="sm:text-right">{isCli ? '本地 CLI' : 'API 地址'}</FormLabel>
                {isCli ? (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="未检测到可用 CLI" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {field.value && !localClis.some(cli => cli.id === field.value) && (
                        <SelectItem value={field.value}>旧版自定义命令</SelectItem>
                      )}
                      {localClis.map(cli => (
                        <SelectItem key={cli.id} value={cli.id}>
                          {cli.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <FormControl>
                    <Input {...field} placeholder="https://api.example.com/v1" />
                  </FormControl>
                )}
                <Button type="button" onClick={handleTest} variant="outline" disabled={testing}>
                  {testing ? '测试中...' : '测试连通性'}
                </Button>
                {isCli && (
                  <FormDescription className="sm:col-span-2 sm:col-start-2">
                    需先设置 LOCAL_CLI_ENABLED=true；CLI 应已安装并完成登录。
                  </FormDescription>
                )}
                <FormMessage className="sm:col-span-2 sm:col-start-2" />
              </FormItem>
            )}
          />

          <div className="pt-2 sm:pl-28">
            <Button
              type="submit"
              disabled={!providerForm.formState.isDirty || providerForm.formState.isSubmitting}
            >
              {id ? '保存修改' : '保存创建'}
            </Button>
          </div>
        </form>
      </Form>

      <div className="flex max-w-2xl flex-col gap-4">
        <div className="font-bold">模型列表</div>
        {!id ? (
          <div className="bg-muted/40 text-muted-foreground rounded-md border p-3 text-sm">
            保存供应商后即可添加模型并测试连通性。
          </div>
        ) : (
          <>
            <ModelSelector providerId={id} manual={isCli} onAdded={() => refreshModels(id)} />
            <div className="flex flex-col gap-2">
              <span className="font-bold">已启用模型</span>
              <div className="flex min-h-9 flex-wrap gap-2 rounded p-2.5">
                {models.length === 0 ? (
                  <span className="text-muted-foreground text-sm">尚未添加模型</span>
                ) : (
                  models.map(model => (
                    <span
                      key={model.id}
                      className="inline-flex items-center gap-1 rounded-md bg-blue-100 px-2 py-0.5 text-sm text-blue-700"
                    >
                      {model.model_name}
                      <button
                        type="button"
                        onClick={() => handleDelete(model.id)}
                        className="rounded hover:text-blue-900 focus-visible:outline focus-visible:outline-2"
                        aria-label={`删除模型 ${model.model_name}`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default ProviderForm
