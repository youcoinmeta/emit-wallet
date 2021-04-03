import * as React from 'react';
import {
    IonButton,
    IonChip,
    IonCol,
    IonContent,
    IonIcon,
    IonInput,
    IonItem,
    IonItemDivider,
    IonLabel,
    IonList,
    IonLoading,
    IonModal,
    IonPage,
    IonRow,
    IonSegment,
    IonSegmentButton,
    IonSelect,
    IonSelectOption,
    IonText,
    IonToast
} from "@ionic/react";
import ConfirmTransaction from "./ConfirmTransaction";
import epochService from "../contract/epoch/sero";
import {MinerScenes, MintData} from "../pages/epoch/miner";
import {AccountModel, ChainType, Transaction} from "../types";
import BigNumber from "bignumber.js";
import * as utils from "../utils";
import rpc from "../rpc";
import {DeviceInfo, Period, UserInfo} from "../contract/epoch/sero/types";
import Countdown from 'react-countdown';
import {chevronBack} from "ionicons/icons";
import {Plugins} from "@capacitor/core";
import url from "../utils/url";
import walletWorker from "../worker/walletWorker";
import altarMiner from "../pages/epoch/miner/altar";
import chaosMiner from "../pages/epoch/miner/chaos";

import interVar from "../interval";
import './EpochOrigin.scss';
import {EPOCH_SETTLE_TIME} from "../config";
import EpochAttribute from "./EpochAttribute";
import i18n from "../locales/i18n";

interface State {
    amount: any
    showAlert: boolean
    tx: any
    showToast: boolean
    toastMessage?: string
    color?: string
    selectAxe: string
    checked: boolean
    showLoading: boolean
    periods: Array<Period>
    nexPeriods: Array<Period>
    myPeriods: Array<Period>

    isMining: boolean
    mintData: MintData
    userInfo?: UserInfo
    device?: DeviceInfo
    showModal: boolean
    account?: AccountModel
    tkt: Array<any>

    selectDevice?: DeviceInfo
}

interface Props {
    scenes: MinerScenes
}

const Currency = "LIGHT";
const Category = "EMIT_AX";

class EpochOrigin extends React.Component<Props, State> {


    state: State = {
        amount: "0",
        showAlert: false,
        tx: {},
        showToast: false,
        selectAxe: "",
        checked: false,
        showLoading: false,

        isMining: false,
        mintData: {ne: "0", accountId: "", accountScenes: "", scenes: "", phash: "", address: "", index: ""},
        showModal: false,
        tkt: [],
        periods: [],
        nexPeriods: [],
        myPeriods: []
    }


    componentDidMount() {
        Plugins.StatusBar.setBackgroundColor({
            color: "#152955"
        }).catch(e => {

        })
        this.init().then(() => {

        }).catch(e => {
            console.error(e)
        });
    }

    init = async () => {
        const {scenes} = this.props
        const account = await walletWorker.accountInfo()
        this.miner().setMiner(account.accountId ? account.accountId : "")
        const fromAddress = account.addresses[ChainType.SERO];
        const userInfo = await epochService.userInfo(scenes, fromAddress)
        const device = await epochService.lockedDevice(scenes, fromAddress)
        const period = new BigNumber(userInfo.currentPeriod).toNumber();//new BigNumber(userInfo.settlementPeriod).comparedTo(new BigNumber(userInfo.currentPeriod)) == -1?new BigNumber(userInfo.currentPeriod).toNumber():new BigNumber(userInfo.settlementPeriod).toNumber();
        const myPeriod = new BigNumber(userInfo.settlementPeriod).toNumber();
        const periods = await epochService.userPeriodInfo(scenes, period, fromAddress)
        const nexPeriods = await epochService.userPeriodInfo(scenes, period + 1, fromAddress)

        let myPeriods: Array<Period> = [];
        if (myPeriod > 0 && myPeriod != period) {
            myPeriods = await epochService.userPeriodInfo(scenes, new BigNumber(userInfo.settlementPeriod).toNumber(), fromAddress)
        } else {
            myPeriods = periods
        }


        if (account && userInfo && userInfo.pImage && userInfo && userInfo.pImage.hash && userInfo && userInfo.pImage.serial) {
            await this.miner().init({
                phash: userInfo.pImage.hash,
                address: await utils.getShortAddress(fromAddress),
                index: utils.toHex(userInfo.pImage.serial),
                scenes: scenes,
                accountScenes: this.miner().uKey(),
                accountId: account.accountId
            })
        }
        await this.mintState();
        const tkt = await this.getTicket(fromAddress)
        const isMining = await this.miner().isMining()

        this.setState({
            isMining: isMining,
            userInfo: userInfo,
            device: device,
            account: account,
            tkt: tkt,
            periods: periods,
            nexPeriods: nexPeriods,
            myPeriods: myPeriods
        })

        if (device && device.category) {
            const items: any = document.getElementsByClassName("display-n");
            for (let item of items) {
                item.style.display = "inherit";
            }
        }else{
            const items: any = document.getElementsByClassName("display-n");
            for (let item of items) {
                item.style.display = "none";
            }
        }

        if (isMining) {
            interVar.start(() => {
                this.mintState().then(() => {
                }).catch(e => {
                    console.error(e)
                })
            }, 1 * 1000)
        } else {
            interVar.stop()
        }
    }


    miner = () => {
        return this.props.scenes == MinerScenes.altar ? altarMiner : chaosMiner;
    }

    done = async () => {
        this.setShowLoading(true)
        const data = await epochService.done(this.props.scenes)
        await this.do(data)
    }

    prepare = async () => {
        const {mintData,amount} = this.state;
        this.setShowLoading(true)

        if (mintData.nonceDes) {
            const minNE = await epochService.minPowNE()
            if (new BigNumber(mintData && mintData.ne?mintData.ne:0).comparedTo(new BigNumber(minNE)) == 1 || new BigNumber(amount).toNumber()>0) {
                const data = await epochService.prepare(this.props.scenes, mintData.nonceDes)
                await this.do(data)
            } else {
                return Promise.reject(`${i18n.t("minNE")} ${minNE}`)
            }
        }
    }

    do = async (data: string) => {
        const {account, mintData, device, amount, selectAxe, checked} = this.state;
        if (mintData.scenes == MinerScenes.chaos && !selectAxe && !checked && !device?.category) {
            return Promise.reject(i18n.t("pleaseSelectAxe"))
        }
        if (account) {
            let tx: Transaction | any = {
                from: account.addresses && account.addresses[ChainType.SERO],
                to: epochService.address,
                cy: Currency,
                gasPrice: "0x" + new BigNumber(1).multipliedBy(1e9).toString(16),
                chain: ChainType.SERO,
                amount: "0x0",
                feeCy: Currency,
                value: utils.toHex(amount, 18),
                data: data,
            }
            if (!checked && selectAxe) {
                tx.catg = Category
                tx.tkt = selectAxe
                tx.tickets = [{
                    Category: Category,
                    Value: selectAxe
                }]
            }
            if (checked) {
                tx.value = "0x0";
            }

            tx.gas = await epochService.estimateGas(tx)
            if (tx.gas && tx.gasPrice) {
                tx.feeValue = await epochService.tokenRate(tx.gasPrice, tx.gas);
            }
            this.setState({
                tx: tx,
                showAlert: true
            })
            this.setShowLoading(false)
            this.setShowModal(false)
        }

    }

    setShowAlert = (f: boolean) => {
        this.setState({
            showAlert: f
        })
    }

    confirm = async (hash: string) => {
        let intervalId: any = 0;
        const chain = ChainType.SERO;
        this.setShowLoading(true)
        intervalId = setInterval(() => {
            rpc.getTxInfo(chain, hash).then((rest) => {
                if (rest && rest.num > 0) {
                    // this.setShowToast(true,"success","Commit Successfully!")
                    clearInterval(intervalId);
                    // url.transactionInfo(chain,hash,Currency);
                    this.setShowLoading(false)
                    this.init()
                }
            }).catch(e => {
                console.error(e)
            })
        }, 3000)
        this.setShowAlert(false)
        this.setState({
            amount: "0",
            tx: {},
            selectAxe: "",
            periods: [],
            nexPeriods: [],
            myPeriods: [],
            checked:false
        })
    }

    setShowToast = (f: boolean, color?: string, m?: string) => {
        this.setState({
            showToast: f,
            toastMessage: m,
            color: color
        })
    }

    setShowLoading = (f: boolean) => {
        this.setState({
            showLoading: f
        })
    }

    setOperate = (v: string) => {
        this.setState({
            checked: v == "stop"
        })
    }

    // @ts-ignore
    renderer = ({hours, minutes, seconds, completed}) => {
        if (completed) {
            return <span></span>
        }
        let h = hours, m = minutes, s = seconds;
        if (new BigNumber(hours).toNumber() <= 9) {
            h = "0" + hours;
        }
        if (new BigNumber(minutes).toNumber() <= 9) {
            m = "0" + minutes;
        }
        if (new BigNumber(seconds).toNumber() <= 9) {
            s = "0" + seconds;
        }
        return <div className="countdown">{h}:{m}:{s}</div>;
    };

    getTicket = async (address: string) => {
        const rest = await rpc.getTicket(ChainType.SERO, address)
        return rest ?rest["EMIT_AX"]:[]
    }

    operate = async () => {
        const {isMining} = this.state;
        if (isMining) {
            await this.stop()
        } else {
            await this.start()
        }
        await this.init().catch()
    }

    start = async () => {
        const {scenes} = this.props
        const {account, userInfo} = this.state;
        if (account && userInfo && userInfo.pImage && userInfo && userInfo.pImage.hash && userInfo && userInfo.pImage.serial) {
            await this.miner().start({
                phash: userInfo.pImage.hash,
                address: await utils.getShortAddress(account.addresses[ChainType.SERO]),
                index: utils.toHex(userInfo.pImage.serial),
                scenes: scenes,
                accountScenes: this.miner().uKey(),
                accountId: account.accountId
            })
            this.setState({
                isMining: true
            })
        }
    }

    stop = async () => {
        await this.miner().stop();
        this.setState({
            isMining: false
        })
        this.setShowModal(true)
    }

    async mintState() {
        const rest = await this.miner().mintState()
        const {mintData, isMining} = this.state;
        if (isMining || rest.nonce != mintData.nonce || rest.ne != mintData.ne) {
            this.setState({
                mintData: rest
            })
        }
    }

    setShowModal = (f: boolean) => {
        this.setState({
            showModal: f
        })
    }

    renderStatic = (periods: Array<Period>, b: boolean, text: string, period: number) => {
        const {scenes} = this.props;
        const {userInfo} = this.state;
        const t = <IonText>{text} <span className="font-weight-800 font-ep">{period}</span></IonText>;
        const nextPeriodTime = (userInfo && new BigNumber(userInfo.lastUpdateTime).toNumber() > 0
            ? new BigNumber(userInfo.lastUpdateTime).toNumber() + EPOCH_SETTLE_TIME : 0) * 1000;

        return <>
            {
                scenes == MinerScenes.altar && periods.length == 2 ?
                    <div className="ctx">
                        <IonItemDivider mode="md"><IonText color="dark">{t}</IonText> {b &&
                        <Countdown date={nextPeriodTime} renderer={this.renderer}/>}</IonItemDivider>
                        <IonRow>
                            <IonCol size="3"></IonCol>
                            <IonCol size="3">{i18n.t("my")}</IonCol>
                            <IonCol size="3">{i18n.t("total")}</IonCol>
                            <IonCol size="3">{i18n.t("pool")}</IonCol>
                        </IonRow>
                        <IonRow>
                            <IonCol size="3">HR({new BigNumber(periods[0].pool).multipliedBy(100).dividedBy(
                                new BigNumber(periods[0].pool).plus(new BigNumber(periods[1].pool))
                            ).toFixed(0)}%)</IonCol>
                            <IonCol size="3">{utils.nFormatter(periods[0].ne, 2)}(NE)</IonCol>
                            <IonCol size="3">{utils.nFormatter(periods[0].total, 2)}(NE)</IonCol>
                            <IonCol size="3">{
                                utils.nFormatter(new BigNumber(periods[0].total).toNumber() > 0 ? utils.fromValue(new BigNumber(periods[0].pool).multipliedBy(new BigNumber(periods[0].ne))
                                    .dividedBy(new BigNumber(periods[0].total)), 18) : 0, 2)}(EN)</IonCol>
                        </IonRow>
                        <IonRow>
                            <IonCol size="3">BL({new BigNumber(periods[1].pool).multipliedBy(100).dividedBy(
                                new BigNumber(periods[0].pool).plus(new BigNumber(periods[1].pool))
                            ).toFixed(0)}%)</IonCol>
                            <IonCol size="3">{utils.nFormatter(utils.fromValue(periods[1].ne, 18), 2)}(L)</IonCol>
                            <IonCol size="3">{utils.nFormatter(utils.fromValue(periods[1].total, 18), 2)}(L)</IonCol>
                            <IonCol size="3">{
                                utils.nFormatter(new BigNumber(periods[1].total).toNumber() > 0 ? utils.fromValue(new BigNumber(periods[1].pool).multipliedBy(new BigNumber(periods[1].ne))
                                    .dividedBy(new BigNumber(periods[1].total)), 18).toFixed(0, 1) : 0, 2)}(EN)</IonCol>
                        </IonRow>
                    </div>
                    :
                    scenes == MinerScenes.chaos && periods.length == 1 &&
                    <div className="ctx">
                        <IonItemDivider mode="md"><IonText color="dark">{t}</IonText> {b &&
                        <Countdown date={nextPeriodTime} renderer={this.renderer}/>}</IonItemDivider>
                        <IonRow>
                            <IonCol size="3"></IonCol>
                            <IonCol size="3">{i18n.t("my")}</IonCol>
                            <IonCol size="3">{i18n.t("total")}</IonCol>
                            <IonCol size="3">{i18n.t("pool")}</IonCol>
                        </IonRow>
                        <IonRow>
                            <IonCol size="3">HR</IonCol>
                            <IonCol size="3">{utils.nFormatter(periods[0].ne, 2)}(NE)</IonCol>
                            <IonCol size="3">{utils.nFormatter(periods[0].total, 2)}(NE)</IonCol>
                            <IonCol size="3">{
                                utils.nFormatter(new BigNumber(periods[0].total).toNumber() > 0 ? utils.fromValue(new BigNumber(periods[0].pool).multipliedBy(new BigNumber(periods[0].ne))
                                    .dividedBy(new BigNumber(periods[0].total)), 18).toFixed(0, 1) : 0, 2)}(L)
                            </IonCol>
                        </IonRow>
                    </div>
            }
        </>
    }

    onSelectDevice = async (ticket: string) => {
        if (ticket) {
            const {account} = this.state;
            const rest = await epochService.axInfo(Category, ticket, account && account.addresses[ChainType.SERO])
            this.setState({
                selectDevice: rest,
                selectAxe: ticket
            })
            return
        }
        this.setState({
            selectAxe: ticket
        })
    }

    render() {
        const {scenes} = this.props;
        // const {showModal, mintData, device, userInfo, setShowModal, tkt,periods} = this.props;
        const {
            periods, showAlert, tx, toastMessage, showLoading,
            color, showToast, selectAxe, checked, amount, isMining,
            mintData, device, userInfo, showModal, tkt, nexPeriods, selectDevice, myPeriods
        } = this.state;

        const period = new BigNumber(userInfo ? userInfo.currentPeriod : 0).toNumber();
        const myPeriod = new BigNumber(userInfo ? userInfo.settlementPeriod : 0).toNumber();

        return <IonPage>
            <IonContent fullscreen color="light">

                <div className="content-ion">
                    <IonItem className="heard-bg" color="primary" lines="none">
                        <IonIcon src={chevronBack} style={{color: "#edcc67"}} slot="start" onClick={() => {
                            Plugins.StatusBar.setBackgroundColor({
                                color: "#194381"
                            }).catch(e => {
                            })
                            url.back()
                        }}/>
                        <IonLabel className="text-center text-bold" style={{
                            color: "#edcc67",
                            textTransform: "uppercase"
                        }}>{MinerScenes[this.props.scenes]}</IonLabel>
                        <img src={"./assets/img/epoch/help.png"} width={28} onClick={() => {
                            const help_url = scenes == MinerScenes.altar ?
                                "https://docs.emit.technology/emit-documents/emit-epoch/origin-universe/altar-scenes" :
                                "https://docs.emit.technology/emit-documents/emit-epoch/origin-universe/chaos-scenes";
                            Plugins.Browser.open({url: help_url, presentationStyle: "popover"}).catch(e => {
                                console.error(e)
                            })
                        }}/>
                    </IonItem>

                    <div style={{padding: "0 10vw", minHeight: "125px"}}>
                        <EpochAttribute device={device} driver={userInfo && userInfo.driver} showDevice={true}
                                        showDriver={true}/>
                    </div>
                    <div onClick={() => {
                        this.setShowModal(true)
                        this.init().catch()
                    }}>
                        {this.props.children}
                    </div>
                    <div>
                        {mintData && mintData.ne &&
                        <div className="ne-text">
                            {mintData && mintData.ne}<span style={{letterSpacing: "2px", color: "#f0f"}}>NE</span>
                        </div>
                        }
                        {mintData && mintData.nonce && <div className="nonce-text">
                            <span className="nonce-span">{mintData && mintData.nonce}</span>
                        </div>}
                        <div className="start-btn" style={{background: !!isMining ? "red" : "green"}}
                             onClick={() => {
                                 this.operate().then(() => {
                                 }).catch((e) => {
                                     console.error(e)
                                 })
                             }}>
                            <div style={{margin: "10.5vw 0"}} className="font-ep">
                                {!!isMining ? `${new BigNumber(mintData.hashrate ? mintData.hashrate.o : 0).toFixed(0)}/s` : "HashRate"}
                            </div>
                        </div>
                    </div>
                </div>


                <IonModal
                    isOpen={showModal}
                    cssClass='epoch-modal'
                    swipeToClose={true}
                    onDidDismiss={() => this.setShowModal(false)}>
                    <div className="epoch-md">
                        <div>
                            <div className="modal-header">{scenes == MinerScenes.altar ? i18n.t("forging"):i18n.t("mining")}</div>
                            {/*<div className="close" onClick={() => {*/}
                            {/*    this.props.setShowModal(false)*/}
                            {/*}}>X*/}
                            {/*</div>*/}
                        </div>
                        <IonList>
                            {
                                device && device.category &&
                                <div style={{padding: "12px"}}>
                                    <IonRow>
                                        <IonCol size="1"></IonCol>
                                        <IonCol>
                                            <IonSegment mode="ios"
                                                        onIonChange={(e: any) => this.setOperate(e.detail.value)}
                                                        value={checked ? "stop" : "refining"}>
                                                <IonSegmentButton value="refining">
                                                    <IonLabel>{i18n.t("prepare")}</IonLabel>
                                                </IonSegmentButton>
                                                <IonSegmentButton value="stop">
                                                    <IonLabel>{i18n.t("retrieve")}</IonLabel>
                                                </IonSegmentButton>
                                            </IonSegment>
                                        </IonCol>
                                        <IonCol size="1"></IonCol>
                                    </IonRow>
                                </div>
                            }
                            {
                                ((device && device.category || tkt && tkt.length > 0) && !checked) &&
                                <>
                                    <IonItem>
                                        <IonLabel><span className="font-md">{i18n.t("changeAxe")}</span></IonLabel>
                                        <IonSelect mode="ios" value={selectAxe} onIonChange={(e: any) => {
                                            this.onSelectDevice(e.detail.value).catch(e => {
                                                console.error(e)
                                            })
                                        }
                                        }>
                                            {
                                                MinerScenes.altar == mintData.scenes &&
                                                <IonSelectOption value={""}>{
                                                    device && device.category ? i18n.t("notChange") : i18n.t("newAxe")
                                                }</IonSelectOption>
                                            }
                                            {
                                                MinerScenes.chaos == mintData.scenes && device && device.category &&
                                                <IonSelectOption value={""}>{i18n.t("notChange")}</IonSelectOption>
                                            }
                                            {
                                                tkt && tkt.map(value => {
                                                    return <IonSelectOption
                                                        value={value.tokenId}>{value.tokenId}</IonSelectOption>
                                                })
                                            }
                                        </IonSelect>
                                    </IonItem>
                                </>
                            }
                            {
                                selectAxe &&
                                <div style={{padding: "0 12px"}}>
                                    <EpochAttribute device={selectDevice} showDevice={true} showDriver={false}/>
                                </div>
                            }
                            {
                                !checked && <IonItem>
                                    <IonLabel><span className="font-md">HashRate(HR)</span></IonLabel>
                                    <IonChip color="tertiary"
                                             className="font-weight-800 font-ep">{mintData && mintData.ne} NE</IonChip>
                                </IonItem>
                            }
                            {
                                mintData.scenes == MinerScenes.altar && !checked && <IonItem>
                                    <IonLabel position="stacked">Burn LIGHT(BL)</IonLabel>
                                    <IonInput mode="ios" placeholder="0" value={amount} onIonChange={(v) => {
                                        this.setState({
                                            amount: v.detail.value
                                        })
                                    }}/>
                                </IonItem>
                            }
                        </IonList>
                        <div className="epoch-desc">
                            {
                                this.renderStatic(nexPeriods, true, i18n.t("currentPeriod"), period + 1)
                            }
                            {
                                this.renderStatic(periods, false, i18n.t("lastPeriod"), period)
                            }
                            {
                                this.renderStatic(myPeriods, false, i18n.t("myLastPeriod"), myPeriod)
                            }
                        </div>
                        <div className="btn-bottom">
                            <IonRow>
                                <IonCol size="4">
                                    <IonButton expand="block" mode="ios" fill={"outline"} color="primary"
                                               onClick={() => {
                                                   this.setShowModal(false)
                                               }}>{i18n.t("cancel")}</IonButton>
                                </IonCol>
                                <IonCol size="8">
                                    <IonButton expand="block" mode="ios" color="primary"
                                               disabled={
                                                   checked && userInfo && new BigNumber(userInfo.currentPeriod).toNumber() < new BigNumber(userInfo.settlementPeriod).toNumber() ||
                                                   !checked && new BigNumber(mintData && mintData.ne ? mintData.ne : 0).toNumber() == 0 && mintData.scenes == MinerScenes.chaos ||
                                                   new BigNumber(mintData && mintData.ne ? mintData.ne : 0).toNumber() == 0 && new BigNumber(amount).toNumber() == 0 && mintData.scenes == MinerScenes.altar && !checked}
                                               onClick={() => {
                                                   if (checked) {
                                                       this.done().then(() => {
                                                       }).catch(e => {
                                                           this.setShowLoading(false)
                                                           const err = typeof e == "string" ? e : e.message;
                                                           this.setShowToast(true, "warning", err)
                                                       })
                                                   } else {
                                                       this.prepare().then(() => {
                                                       }).catch(e => {
                                                           this.setShowLoading(false)
                                                           const err = typeof e == "string" ? e : e.message;
                                                           this.setShowToast(true, "warning", err)
                                                       })
                                                   }
                                               }}>
                                        {
                                            checked && userInfo && new BigNumber(userInfo.currentPeriod).toNumber() < new BigNumber(userInfo.settlementPeriod).toNumber() ? "Your Period is in progress" :
                                                !checked && new BigNumber(mintData && mintData.ne ? mintData.ne : 0).toNumber() == 0 && mintData.scenes == MinerScenes.chaos ? "HashRate is 0" :
                                                    new BigNumber(mintData && mintData.ne ? mintData.ne : 0).toNumber() == 0 && new BigNumber(amount).toNumber() == 0 && mintData.scenes == MinerScenes.altar && !checked ? "HR or BL is 0" : i18n.t("commit")
                                        }
                                        {/*{*/}
                                        {/*    userInfo && userInfo.currentPeriod < userInfo.settlementPeriod?*/}
                                        {/*        <Countdown date={nextPeriodTime} renderer={this.renderer}/>*/}
                                        {/*        :"Commit"*/}
                                        {/*}*/}
                                    </IonButton>
                                </IonCol>
                            </IonRow>
                        </div>
                    </div>
                </IonModal>

                <IonToast
                    color={!color ? "warning" : color}
                    position="top"
                    isOpen={showToast}
                    onDidDismiss={() => this.setShowToast(false)}
                    message={toastMessage}
                    duration={1500}
                    mode="ios"
                />


                <IonLoading
                    mode="ios"
                    spinner={"bubbles"}
                    cssClass='my-custom-class'
                    isOpen={showLoading}

                    onDidDismiss={() => this.setShowLoading(false)}
                    message={'Please wait...'}
                    duration={120000}
                />

                <ConfirmTransaction show={showAlert} transaction={tx} onProcess={(f) => {
                }} onCancel={() => this.setShowAlert(false)} onOK={this.confirm}/>

            </IonContent>
        </IonPage>;
    }
}


export default EpochOrigin